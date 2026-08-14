import fs from "node:fs/promises";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import { config, ROOT_DIR } from "../config.js";
import { buildCodexChildEnv } from "./codexEnv.js";
import { CODEX_FINAL_SCHEMA } from "./codexFinalSchema.js";

const SDK_MCP_SERVER_NAME = "korean_law";
const SDK_MCP_STARTUP_TIMEOUT_SEC = 120;
const SDK_FORBIDDEN_ITEM_TYPES = new Set([
  "command_execution",
  "web_search",
  "browser",
  "computer",
  "file_search",
  "repo_read",
  "repo_write",
  "git",
  "github",
]);

const PLATFORM_RUNTIME = Object.freeze({
  "win32-x64": { packageName: "@openai/codex-win32-x64", triple: "x86_64-pc-windows-msvc", binary: "codex.exe", host: "codex-code-mode-host.exe" },
  "win32-arm64": { packageName: "@openai/codex-win32-arm64", triple: "aarch64-pc-windows-msvc", binary: "codex.exe", host: "codex-code-mode-host.exe" },
  "linux-x64": { packageName: "@openai/codex-linux-x64", triple: "x86_64-unknown-linux-musl", binary: "codex", host: "codex-code-mode-host" },
  "linux-arm64": { packageName: "@openai/codex-linux-arm64", triple: "aarch64-unknown-linux-musl", binary: "codex", host: "codex-code-mode-host" },
  "darwin-x64": { packageName: "@openai/codex-darwin-x64", triple: "x86_64-apple-darwin", binary: "codex", host: "codex-code-mode-host" },
  "darwin-arm64": { packageName: "@openai/codex-darwin-arm64", triple: "aarch64-apple-darwin", binary: "codex", host: "codex-code-mode-host" },
});

function runtimeKey(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

function sdkError(code, message, cause = null) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isAuthFailure(error) {
  return /authenticat|unauthori[sz]ed|not logged in|sign[ -]?in|login|token/iu.test(String(error?.message || ""));
}

function createSessionDirectory(baseDir, index) {
  return path.join(baseDir, `${String(index).padStart(3, "0")}-${Date.now()}`);
}

function mcpArguments(item) {
  return item?.arguments && typeof item.arguments === "object" && !Array.isArray(item.arguments)
    ? item.arguments
    : {};
}

function mcpName(item) {
  return String(item?.tool || item?.name || item?.tool_name || "");
}

function usageFromEvent(event) {
  const usage = event?.usage || null;
  if (!usage) return null;
  return {
    input_tokens: Number(usage.input_tokens || 0),
    cached_input_tokens: Number(usage.cached_input_tokens || 0),
    output_tokens: Number(usage.output_tokens || 0),
    reasoning_tokens: Number(usage.reasoning_output_tokens || 0),
  };
}

function textFromAgentMessage(item) {
  return item?.type === "agent_message" && typeof item.text === "string" ? item.text : "";
}

function parseFinalSelection(text) {
  try {
    const selection = JSON.parse(text);
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw new Error("final response is not an object");
    }
    return selection;
  } catch (error) {
    throw sdkError("CODEX_SDK_FINAL_INVALID", "SDK final response is not valid JSON", error);
  }
}

function buildSdkConfig(proxyPath) {
  return {
    mcp_servers: {
      [SDK_MCP_SERVER_NAME]: {
        command: process.execPath,
        args: [proxyPath],
        startup_timeout_sec: SDK_MCP_STARTUP_TIMEOUT_SEC,
      },
    },
  };
}

export function buildCodexSdkEnv(source = process.env, { legalMcpLogPath = "" } = {}) {
  // Do not set CODEX_HOME to Case Finder's empty managed directory. Preserve an
  // explicit user setting, otherwise point the packaged runtime at the user's
  // conventional Codex home so it can read its existing login state.
  const env = buildCodexChildEnv(source, { legalMcpLogPath });
  // The packaged Windows binary resolves its home directory from HOME before
  // consulting the Windows-specific variables. The desktop launcher commonly
  // has USERPROFILE but no HOME, so provide a non-secret compatibility fallback
  // while preserving an explicitly configured HOME when one exists.
  if (!env.HOME) {
    env.HOME = env.USERPROFILE || `${env.HOMEDRIVE || ""}${env.HOMEPATH || ""}`;
  }
  if (!env.CODEX_HOME && env.HOME) env.CODEX_HOME = path.join(env.HOME, ".codex");
  return env;
}

export async function inspectPackagedCodexRuntime({
  platform = process.platform,
  arch = process.arch,
  fsImpl = fs,
  resolvePackage = (name) => import.meta.resolve(name),
} = {}) {
  const target = PLATFORM_RUNTIME[`${platform}-${arch}`];
  if (!target) throw sdkError("CODEX_SDK_PLATFORM_UNSUPPORTED", `unsupported platform: ${platform}/${arch}`);
  let packageJsonPath;
  try {
    packageJsonPath = await resolvePackage(`${target.packageName}/package.json`);
  } catch (error) {
    throw sdkError("CODEX_SDK_RUNTIME_UNAVAILABLE", "packaged Codex platform dependency is missing", error);
  }
  const packageRoot = path.dirname(new URL(packageJsonPath).pathname).replace(/^\/(\w):/u, "$1:");
  const vendorRoot = path.join(packageRoot, "vendor", target.triple);
  const executablePath = path.join(vendorRoot, "bin", target.binary);
  const hostPath = path.join(vendorRoot, "bin", target.host);
  const [executable, host] = await Promise.all([
    fsImpl.stat(executablePath).then(() => true, () => false),
    fsImpl.stat(hostPath).then(() => true, () => false),
  ]);
  if (!executable || !host) {
    throw sdkError("CODEX_SDK_RUNTIME_UNAVAILABLE", "packaged Codex runtime helper is missing");
  }
  return { packageName: target.packageName, triple: target.triple, executable, host };
}

export function createCodexSdkClient({
  CodexClass = Codex,
  source = process.env,
  legalMcpLogPath = "",
  proxyPath = process.env.CODEX_LEGAL_MCP_BRIDGE || path.join(ROOT_DIR, "src", "aoV2", "restrictedMcp", "stdioServer.js"),
} = {}) {
  try {
    return new CodexClass({
      env: buildCodexSdkEnv(source, { legalMcpLogPath }),
      config: buildSdkConfig(proxyPath),
    });
  } catch (error) {
    if (error?.code === "CODEX_SDK_RUNTIME_UNAVAILABLE") throw error;
    throw sdkError("CODEX_SDK_RUNTIME_UNAVAILABLE", "Codex SDK runtime could not be initialized", error);
  }
}

export function createCodexSdkSessionFactory({
  baseDir = config.codexWorkdir,
  CodexClass = Codex,
  source = process.env,
  proxyPath = process.env.CODEX_LEGAL_MCP_BRIDGE || path.join(ROOT_DIR, "src", "aoV2", "restrictedMcp", "stdioServer.js"),
} = {}) {
  let sessionIndex = 0;
  return async ({
    prompt,
    model = config.codexModel,
    reasoningEffort = config.codexReasoningEffort,
    onDelegatedToolResult,
  } = {}) => {
    const index = sessionIndex++;
    const sessionDir = createSessionDirectory(baseDir, index);
    const workdir = path.join(sessionDir, "workdir");
    const proxyLogPath = path.join(sessionDir, "proxy.log");
    await fs.mkdir(workdir, { recursive: true });

    const client = createCodexSdkClient({
      CodexClass,
      source,
      legalMcpLogPath: proxyLogPath,
      proxyPath,
    });
    const thread = client.startThread({
      model,
      sandboxMode: "read-only",
      workingDirectory: workdir,
      skipGitRepoCheck: true,
      modelReasoningEffort: reasoningEffort,
      webSearchMode: "disabled",
    });
    const controller = new AbortController();
    const sessionTimerMs = Math.max(30_000, Number.parseInt(
      process.env.LUNA_SESSION_TIMEOUT_MS || String(config.codexTimeoutMs),
      10,
    ));
    const queue = [];
    const waiters = [];
    const calls = new Map();
    const startedAt = Date.now();
    let pumpPromise = null;
    let timer = null;
    let ended = false;
    let closed = false;
    let timedOut = false;
    let terminalError = null;
    let finalQueued = false;
    let finalText = "";
    let usage = null;
    let sessionId = null;

    function enqueue(value) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(value);
      else queue.push(value);
    }

    function fail(error) {
      if (terminalError || ended) return;
      terminalError = error;
      ended = true;
      for (const waiter of waiters.splice(0)) waiter.reject(error);
    }

    function complete() {
      ended = true;
      for (const waiter of waiters.splice(0)) waiter.resolve(null);
    }

    function emitForbidden(item) {
      const type = String(item?.type || "").toLowerCase();
      if (!SDK_FORBIDDEN_ITEM_TYPES.has(type)) return false;
      enqueue({ type, raw: { type } });
      return true;
    }

    function handleMcpItem(item, eventType) {
      const name = mcpName(item);
      const args = mcpArguments(item);
      if (eventType === "item.started") {
        calls.set(item.id, { name, arguments: args });
        enqueue({ type: "mcp_tool_call", delegated: true, call_id: item.id, name, arguments: args });
        return;
      }
      if (eventType !== "item.completed" || typeof onDelegatedToolResult !== "function") return;
      const call = calls.get(item.id) || { name, arguments: args };
      const result = item.error
        ? { isError: true, message: item.error.message || "Codex MCP tool call failed" }
        : item.result || {};
      onDelegatedToolResult({
        callId: item.id,
        name: call.name,
        arguments: call.arguments,
        result,
      });
    }

    async function pump() {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        fail(sdkError("CODEX_NATIVE_SESSION_TIMEOUT", "Codex SDK session timed out"));
      }, sessionTimerMs);
      try {
        const streamed = await thread.runStreamed(prompt, {
          outputSchema: CODEX_FINAL_SCHEMA,
          signal: controller.signal,
        });
        for await (const event of streamed.events) {
          if (event.type === "thread.started") {
            sessionId = event.thread_id || sessionId;
            continue;
          }
          if (event.type === "item.started" || event.type === "item.completed") {
            const item = event.item || {};
            if (item.type === "mcp_tool_call") {
              handleMcpItem(item, event.type);
              continue;
            }
            if (emitForbidden(item)) continue;
            if (event.type === "item.completed") finalText = textFromAgentMessage(item) || finalText;
            continue;
          }
          if (event.type === "turn.completed") {
            usage = usageFromEvent(event) || usage;
            if (!finalText) throw sdkError("CODEX_SDK_FINAL_MISSING", "Codex SDK turn completed without final response");
            enqueue({
              type: "final",
              selection: parseFinalSelection(finalText),
              usage,
              elapsedMs: Date.now() - startedAt,
              session_id: sessionId || thread.id || null,
            });
            finalQueued = true;
            complete();
            continue;
          }
          if (event.type === "turn.failed") {
            throw isAuthFailure(event.error)
              ? sdkError("CODEX_AUTH_REQUIRED", "Codex authentication is unavailable")
              : sdkError("CODEX_SDK_TURN_FAILED", "Codex SDK turn failed");
          }
          if (event.type === "error") {
            throw isAuthFailure(event)
              ? sdkError("CODEX_AUTH_REQUIRED", "Codex authentication is unavailable")
              : sdkError("CODEX_SDK_STREAM_FAILED", "Codex SDK stream failed");
          }
        }
        if (!finalQueued && !terminalError && !closed) {
          throw sdkError("CODEX_SDK_FINAL_MISSING", "Codex SDK stream ended without final response");
        }
      } catch (error) {
        if (terminalError) return;
        if (timedOut) {
          fail(sdkError("CODEX_NATIVE_SESSION_TIMEOUT", "Codex SDK session timed out", error));
        } else if (closed && error?.name === "AbortError") {
          complete();
        } else if (error?.code?.startsWith("CODEX_")) {
          fail(error);
        } else if (isAuthFailure(error)) {
          fail(sdkError("CODEX_AUTH_REQUIRED", "Codex authentication is unavailable", error));
        } else {
          fail(sdkError("CODEX_SDK_EXECUTION_FAILED", "Codex SDK execution failed", error));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    return {
      get sessionId() { return sessionId; },
      get session_id() { return sessionId; },
      get finalQueued() { return finalQueued; },
      async next() {
        if (!pumpPromise) pumpPromise = pump();
        if (queue.length) return queue.shift();
        if (terminalError) throw terminalError;
        if (ended) return null;
        return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      },
      async close() {
        if (closed) return;
        closed = true;
        if (!ended) controller.abort();
        if (timer) clearTimeout(timer);
        if (pumpPromise) await Promise.race([
          pumpPromise,
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
      },
    };
  };
}
