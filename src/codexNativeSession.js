import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { config, ROOT_DIR } from "../config.js";

const FINAL_SCHEMA = {
  name: "m9-native-final",
  type: "object",
  additionalProperties: false,
  properties: {
    selected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          case_no: { type: "string" },
          match: { type: "string", enum: ["direct", "related"] },
        },
        required: ["case_no", "match"],
      },
    },
    intro: { type: "string" },
  },
  required: ["selected", "intro"],
};

const FORBIDDEN_EVENT_TYPES = /(command_execution|shell|computer|file_search|web_search|browser|repo|git|github)/iu;

const CODEX_CHILD_ENV_KEYS = Object.freeze([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "SYSTEMDRIVE",
  "CODEX_HOME",
]);

export function buildCodexChildEnv(source = process.env, { legalMcpLogPath = "" } = {}) {
  const env = {};
  for (const key of CODEX_CHILD_ENV_KEYS) {
    if (typeof source?.[key] === "string" && source[key]) env[key] = source[key];
  }
  if (legalMcpLogPath) env.LEGAL_MCP_LOG_PATH = legalMcpLogPath;
  return env;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function safeDiagnostic(value) {
  return String(value || "")
    .replace(/(?:LAW_OC|OC)\s*[=:]\s*[^\s&]+/giu, "OC=[REDACTED]")
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [REDACTED]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(-2_000);
}

function usageFromEvent(event) {
  const raw = event?.usage
    || event?.item?.usage
    || event?.payload?.info?.last_token_usage
    || event?.payload?.info?.total_token_usage;
  if (!raw) return null;
  return {
    input_tokens: Number(raw.input_tokens || 0),
    cached_input_tokens: Number(raw.cached_input_tokens || 0),
    output_tokens: Number(raw.output_tokens || 0),
    reasoning_tokens: Number(raw.reasoning_tokens ?? raw.reasoning_output_tokens ?? 0),
  };
}

function eventSessionId(event) {
  return event?.thread_id
    || event?.threadId
    || event?.payload?.thread_id
    || event?.payload?.threadId
    || null;
}

function eventItemType(event) {
  return String(event?.item?.type || event?.type || "").toLowerCase();
}

function delegatedResult(item) {
  return item?.result || item?.output || item?.content || item?.tool_result || null;
}

function parseArguments(value) {
  if (typeof value !== "string") return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}

function resolveCodexCommand() {
  const configured = process.env.CODEX_CLI_PATH || config.codexCliPath;
  if (process.platform === "win32" && configured === "codex") {
    const appData = process.env.APPDATA || "";
    const cliScript = appData
      ? path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
      : "";
    if (cliScript && fsSync.existsSync(cliScript)) {
      return { command: process.execPath, prefixArgs: [cliScript], shell: false };
    }
    try {
      const discovered = execFileSync("where.exe", ["codex.exe"], { encoding: "utf8", windowsHide: true })
        .split(/\r?\n/u)
        .map((item) => item.trim())
        .find(Boolean);
      if (discovered) return { command: discovered, prefixArgs: [], shell: false };
    } catch {
      // Fall back to PATH resolution below.
    }
    return { command: "codex.exe", prefixArgs: [], shell: false };
  }
  return {
    command: configured,
    prefixArgs: [],
    shell: process.platform === "win32" && configured.toLowerCase().endsWith(".cmd"),
  };
}

function createSessionDirectory(baseDir, index) {
  return path.join(baseDir, `${String(index).padStart(3, "0")}-${Date.now()}`);
}

export function createCodexCliSessionFactory({
  baseDir = process.env.LUNA_SESSION_DIR || config.codexWorkdir,
  proxyPath = process.env.CODEX_LEGAL_MCP_BRIDGE || path.join(ROOT_DIR, "src", "aoV2", "restrictedMcp", "stdioServer.js"),
} = {}) {
  let sessionIndex = 0;
  return async ({ prompt, model = config.codexModel, reasoningEffort = config.codexReasoningEffort, onDelegatedToolResult } = {}) => {
    const index = sessionIndex++;
    const sessionDir = createSessionDirectory(baseDir, index);
    const workdir = path.join(sessionDir, "workdir");
    const schemaPath = path.join(sessionDir, "final.schema.json");
    const finalPath = path.join(sessionDir, "final.json");
    const proxyLogPath = path.join(sessionDir, "proxy.log");
    await fs.mkdir(workdir, { recursive: true });
    await fs.writeFile(schemaPath, `${JSON.stringify(FINAL_SCHEMA, null, 2)}\n`, "utf8");
    await fs.rm(finalPath, { force: true });

    const args = [
      "exec", "--json", "--model", model, "--sandbox", "read-only",
      "--cd", workdir, "--skip-git-repo-check", "--ignore-user-config", "--color", "never",
      "-c", `model_reasoning_effort=\"${reasoningEffort}\"`,
      "-c", `mcp_servers.korean_law.command=${tomlString(process.execPath)}`,
      "-c", `mcp_servers.korean_law.args=${JSON.stringify([proxyPath])}`,
      "-c", "mcp_servers.korean_law.startup_timeout_sec=120",
      "--output-schema", schemaPath,
      "--output-last-message", finalPath,
      "-",
    ];
    const codexCommand = resolveCodexCommand();
    const child = spawn(codexCommand.command, [...codexCommand.prefixArgs, ...args], {
      cwd: workdir,
      env: buildCodexChildEnv(process.env, { legalMcpLogPath: proxyLogPath }),
      windowsHide: true,
      shell: codexCommand.shell,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const events = [];
    const forbidden = [];
    const sessionIds = new Set();
    const delegatedCalls = new Map();
    const queue = [];
    const waiters = [];
    let stdoutBuffer = "";
    let stderr = "";
    let ended = false;
    let timedOut = false;
    let finalReturned = false;
    let lastUsage = null;
    let closeResult = null;
    let resolveClose;
    const closePromise = new Promise((resolve) => { resolveClose = resolve; });
    const sessionTimerMs = Math.max(30_000, Number.parseInt(
      process.env.LUNA_SESSION_TIMEOUT_MS || String(config.codexTimeoutMs),
      10,
    ));

    function enqueue(value) {
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    }

    function processLine(line) {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      events.push(event);
      const sessionId = eventSessionId(event);
      if (sessionId) sessionIds.add(sessionId);
      lastUsage = usageFromEvent(event) || lastUsage;
      if (FORBIDDEN_EVENT_TYPES.test(eventItemType(event))) {
        const type = eventItemType(event);
        forbidden.push(type);
        enqueue({ type: type.includes("command") ? "command_execution" : type, raw: event });
        return;
      }
      const item = event?.item || {};
      if (String(item.type || "") !== "mcp_tool_call") return;
      const callId = item.id || null;
      const name = item.name || item.tool_name || item.server_tool_name || item.tool || "";
      const argsValue = parseArguments(item.arguments || item.input || item.params || {});
      if (event.type === "item.started") {
        delegatedCalls.set(callId, { name, arguments: argsValue });
        enqueue({ type: "mcp_tool_call", delegated: true, call_id: callId, name, arguments: argsValue });
      } else if (event.type === "item.completed" && typeof onDelegatedToolResult === "function") {
        const call = delegatedCalls.get(callId) || { name, arguments: argsValue };
        onDelegatedToolResult({
          callId,
          name: call.name,
          arguments: call.arguments,
          result: delegatedResult(item),
        });
      }
    }

    const sessionTimer = setTimeout(() => {
      timedOut = true;
      enqueue({ type: "session_timeout" });
      child.kill();
    }, sessionTimerMs);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        processLine(line);
      }
    });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(sessionTimer);
      ended = true;
      closeResult = { code: null, signal: null, error: error.message };
      for (const waiter of waiters.splice(0)) waiter(Promise.reject(error));
      resolveClose();
    });
    child.once("close", async (code, signal) => {
      if (stdoutBuffer.trim()) processLine(stdoutBuffer);
      if (!finalReturned) {
        const finalText = await fs.readFile(finalPath, "utf8").catch(() => "");
        if (finalText) {
          try {
            finalReturned = true;
            enqueue({ type: "final", selection: JSON.parse(finalText), usage: lastUsage, elapsedMs: 0, session_id: [...sessionIds][0] || null });
          } catch {
            // next() reports the invalid final artifact with a diagnostic.
          }
        }
      }
      clearTimeout(sessionTimer);
      ended = true;
      closeResult = { code, signal };
        for (const waiter of waiters.splice(0)) waiter(timedOut ? Promise.reject(new Error("CODEX_NATIVE_SESSION_TIMEOUT")) : null);
      resolveClose();
    });
    child.stdin.end(prompt);

    return {
      sessionId: null,
      events,
      forbidden,
      sessionIds,
      get stderr() { return stderr; },
      get closeResult() { return closeResult; },
      async next() {
        if (queue.length) return queue.shift();
        if (!ended) return new Promise((resolve) => waiters.push(resolve));
        if (finalReturned) return null;
        finalReturned = true;
        if (timedOut) throw new Error("CODEX_NATIVE_SESSION_TIMEOUT");
        const finalText = await fs.readFile(finalPath, "utf8").catch(() => "");
        if (!finalText) {
          const processDiagnostic = closeResult?.code !== 0
            ? `CODEX_NATIVE_PROCESS_FAILED:${closeResult?.code}:${safeDiagnostic(stderr)}`
            : `CODEX_NATIVE_FINAL_MISSING:${safeDiagnostic(stderr)}`;
          throw new Error(processDiagnostic);
        }
        let selection;
        try { selection = JSON.parse(finalText); } catch (error) { throw new Error(`CODEX_NATIVE_FINAL_INVALID:${error.message}`); }
        if (closeResult?.code !== 0) throw new Error(`CODEX_NATIVE_PROCESS_FAILED:${closeResult?.code}:${safeDiagnostic(stderr)}`);
        return { type: "final", selection, usage: lastUsage, elapsedMs: 0, session_id: [...sessionIds][0] || null };
      },
      async close() {
        clearTimeout(sessionTimer);
        if (!ended) child.kill();
        await Promise.race([closePromise, new Promise((done) => setTimeout(done, 2_000))]);
      },
    };
  };
}
