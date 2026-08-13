import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dotenvPath = path.resolve(ROOT_DIR, "..", "..", ".env");
loadDotenv({ path: dotenvPath, quiet: true });

const { config } = await import("../config.js");
const { closeMcp, startMcp } = await import("../src/mcpClient.js");
const { createAgenticSearchV2 } = await import("../src/aoV2/index.js");
const { caseNumberMatches } = await import("../src/router.js");

const PRIVATE_ROOT = path.resolve(process.env.M8_RUN_DIR || path.join(ROOT_DIR, "test", "private", "m8-known10"));
const CODEX_PATH = process.env.M8_CODEX_CLI_PATH
  || process.env.CODEX_CLI_PATH
  || "C:\\Users\\Y\\AppData\\Local\\OpenAI\\Codex\\bin\\cfac6bda2d141e07\\codex.exe";
const MODEL = config.codexModel;
const REASONING_EFFORT = config.codexReasoningEffort;
const SEED = "m7r-native-paired-shared-plan-v1";
const POPULATION = process.env.M8_POPULATION || "known10";
if (!new Set(["known10", "golden17"]).has(POPULATION)) throw new Error(`M8_INVALID_POPULATION:${POPULATION}`);
const ARTIFACT_PREFIX = POPULATION === "golden17" ? "golden17" : "known10";
const CHECKPOINT_PREFIX = POPULATION === "golden17" ? "M8_GOLDEN17" : "M8_KNOWN10";
const QUESTION_IDS = [
  "statute-medical-service-24-2",
  "domain-constitutional-adultery",
  "domain-constitutional-alternative-service",
  "related-transfer-abuse",
  "domain-admin-information-disclosure",
  "domain-admin-prior-notice",
  "sparse-demotion-role",
  "sparse-relocation",
  "related-medical-explanation",
  "related-platform-union-worker",
];
const FINAL_SCHEMA = {
  name: "m8-native-final",
  type: "object",
  additionalProperties: false,
  properties: {
    selected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { case_no: { type: "string" }, match: { type: "string", enum: ["direct", "related"] } },
        required: ["case_no", "match"],
      },
    },
    intro: { type: "string" },
  },
  required: ["selected", "intro"],
};
const armArg = process.argv.find((value) => value.startsWith("--arm="))?.slice("--arm=".length) || "both";
const arms = armArg === "both" ? ["gemini", "luna"] : [armArg];
if (!arms.every((arm) => ["gemini", "luna"].includes(arm))) throw new Error(`M8_INVALID_ARM:${armArg}`);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function fixedShuffle(items) {
  return [...items].sort((left, right) => sha256(`${SEED}:${left.id}`).localeCompare(sha256(`${SEED}:${right.id}`)));
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
  const raw = event?.usage || event?.item?.usage || event?.payload?.info?.last_token_usage || event?.payload?.info?.total_token_usage;
  if (!raw) return null;
  return {
    input_tokens: Number(raw.input_tokens || 0),
    cached_input_tokens: Number(raw.cached_input_tokens || 0),
    output_tokens: Number(raw.output_tokens || 0),
    reasoning_tokens: Number(raw.reasoning_tokens ?? raw.reasoning_output_tokens ?? 0),
  };
}

function eventSessionId(event) {
  return event?.thread_id || event?.threadId || event?.payload?.thread_id || event?.payload?.threadId || null;
}

function eventItemType(event) {
  return String(event?.item?.type || event?.type || "").toLowerCase();
}

function forbiddenEvent(event) {
  const type = eventItemType(event);
  return /(command_execution|shell|computer|file_search|web_search|browser|repo|git|github)/u.test(type);
}

function createCodexSessionFactory({ armDir, questionIndex, runContext }) {
  return async ({ prompt }) => {
    const workdir = path.join(armDir, "workdir", String(questionIndex));
    await fs.mkdir(workdir, { recursive: true });
    const schemaPath = path.join(armDir, `final-${questionIndex}.schema.json`);
    const finalPath = path.join(armDir, `final-${questionIndex}.json`);
    await fs.writeFile(schemaPath, `${JSON.stringify(FINAL_SCHEMA, null, 2)}\n`, "utf8");
    await fs.rm(finalPath, { force: true });
    const proxyPath = path.join(ROOT_DIR, "test", "m8-live-mcp-proxy.cmd");
    const proxyLogPath = path.join(armDir, `proxy-${questionIndex}.log`);
    const args = [
      "exec", "--json", "--model", MODEL, "--sandbox", "read-only",
      "--cd", workdir, "--skip-git-repo-check", "--ignore-user-config", "--color", "never",
      "-c", `model_reasoning_effort=\"${REASONING_EFFORT}\"`,
      "-c", `mcp_servers.korean_law.command=${tomlString(proxyPath)}`,
      "-c", "mcp_servers.korean_law.args=[]",
      "-c", "mcp_servers.korean_law.startup_timeout_sec=120",
      "--output-schema", schemaPath,
      "--output-last-message", finalPath,
      "-",
    ];
    const child = spawn(CODEX_PATH, args, {
      cwd: workdir,
      env: { ...process.env, M8_PROXY_LOG_PATH: proxyLogPath },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const events = [];
    const forbidden = [];
    const sessionIds = new Set();
    let lastUsage = null;
    let stdoutBuffer = "";
    let stderr = "";
    let ended = false;
    let closeResult = null;
    let timedOut = false;
    let finalReturned = false;
    const queue = [];
    const waiters = [];
    const delegatedCalls = new Map();
    let resolveClose;
    const closePromise = new Promise((resolve) => { resolveClose = resolve; });
    const sessionTimerMs = Math.max(30_000, Number.parseInt(process.env.M8_LUNA_SESSION_TIMEOUT_MS || String(config.aoWallClockMaxMs), 10));
    const sessionTimer = setTimeout(() => {
      timedOut = true;
      enqueue({ type: "session_timeout" });
      child.kill();
    }, sessionTimerMs);

    function enqueue(value) {
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queue.push(value);
    }
    function delegatedResult(item) {
      return item?.result || item?.output || item?.content || item?.tool_result || null;
    }
    function processLine(line) {
      if (!line.trim()) return;
      let event;
      try { event = JSON.parse(line); } catch { return; }
      events.push(event);
      const sessionId = eventSessionId(event);
      if (sessionId) sessionIds.add(sessionId);
      lastUsage = usageFromEvent(event) || lastUsage;
      if (forbiddenEvent(event)) {
        const type = eventItemType(event);
        forbidden.push(type);
        enqueue({ type: type.includes("command") ? "command_execution" : type, raw: event });
        return;
      }
      const item = event?.item || {};
      if (String(item.type || "") === "mcp_tool_call") {
        const callId = item.id || null;
        const name = item.name || item.tool_name || item.server_tool_name || item.tool || "";
        const argumentsValue = item.arguments || item.input || item.params || {};
        if (event.type === "item.started") {
          delegatedCalls.set(callId, { name, arguments: argumentsValue });
          enqueue({ type: "mcp_tool_call", delegated: true, call_id: callId, name, arguments: argumentsValue });
        } else if (event.type === "item.completed" && typeof runContext.recordDelegatedToolResult === "function") {
          const call = delegatedCalls.get(callId) || { name, arguments: argumentsValue };
          runContext.recordDelegatedToolResult({
            callId,
            name: call.name,
            arguments: call.arguments,
            result: delegatedResult(item),
          });
        }
      }
    }
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
            // session.next() will report the invalid final artifact below
          }
        }
      }
      clearTimeout(sessionTimer);
      ended = true;
      closeResult = { code, signal };
      for (const waiter of waiters.splice(0)) {
        waiter(timedOut ? Promise.reject(new Error("M8_CODEX_SESSION_TIMEOUT")) : null);
      }
      resolveClose();
    });
    child.stdin.end(prompt);

    const session = {
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
        if (timedOut) throw new Error("M8_CODEX_SESSION_TIMEOUT");
        const finalText = await fs.readFile(finalPath, "utf8").catch(() => "");
        if (!finalText) throw new Error(`M8_CODEX_FINAL_MISSING:${safeDiagnostic(stderr)}`);
        let selection;
        try { selection = JSON.parse(finalText); } catch (error) { throw new Error(`M8_CODEX_FINAL_INVALID:${error.message}`); }
        if (closeResult?.code !== 0) throw new Error(`M8_CODEX_PROCESS_FAILED:${closeResult?.code}:${safeDiagnostic(stderr)}`);
        return { type: "final", selection, usage: lastUsage, elapsedMs: 0, session_id: [...sessionIds][0] || null };
      },
      async close() {
      clearTimeout(sessionTimer);
        if (!ended) child.kill();
        await Promise.race([closePromise, new Promise((done) => setTimeout(done, 2_000))]);
    },
    };
    runContext.session = session;
    return session;
  };
}

async function loadQuestions() {
  const golden = JSON.parse(await fs.readFile(path.join(ROOT_DIR, "test", "golden.json"), "utf8"));
  if (POPULATION === "golden17") {
    const questions = golden.cases.filter((item) => item.kind === "natural" && Array.isArray(item.expectedCaseNumbers) && item.expectedCaseNumbers.length > 0);
    if (questions.length !== 17) throw new Error(`M8_GOLDEN17_POPULATION_INVALID:${questions.length}`);
    return questions;
  }
  const byId = new Map(golden.cases.filter((item) => QUESTION_IDS.includes(item.id)).map((item) => [item.id, item]));
  const missing = QUESTION_IDS.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`M8_QUESTION_MISSING:${missing.join(",")}`);
  return fixedShuffle(QUESTION_IDS.map((id) => byId.get(id)));
}

function classify(result, question) {
  const selected = result.selected || [];
  const strictHit = selected.some((item) => question.expectedCaseNumbers.some((expected) =>
    caseNumberMatches(String(item.case_no || ""), expected)));
  const outputValid = result.output_valid === true;
  const modelProtocolClean = result.model_protocol_clean === true;
  const status = !outputValid
    ? "OUTPUT_INVALID"
    : !modelProtocolClean
      ? "REPAIRED_OUTPUT"
      : strictHit
        ? "STRICT_HIT"
        : selected.length
          ? "VALID_RELATED_ONLY"
          : "MISS";
  return { status, strictHit, selectedCount: selected.length };
}

function recordFromResult(arm, question, result, extra = {}) {
  const classification = classify(result, question);
  return {
    question_id: question.id,
    question_sha256: sha256(question.query),
    arm,
    model: arm === "luna" ? MODEL : config.geminiModel,
    reasoning_effort: arm === "luna" ? REASONING_EFFORT : null,
    status: classification.status,
    strict_hit: classification.strictHit,
    selected: result.selected || [],
    rejected_selected: result.rejectedSelected || [],
    protocol_diagnostics: result.protocolDiagnostics || [],
    output_valid: result.output_valid === true,
    model_protocol_clean: result.model_protocol_clean === true,
    selection_repaired: result.selection_repaired === true,
    protocol_pass: result.telemetry?.protocol_pass === true,
    ledger_scope_id: result.telemetry?.question_scope_id || result.ledger?.scopeId || null,
    session_id: result.telemetry?.session_id || null,
    observed_cases: result.telemetry?.observed_cases || 0,
    verified_cases: result.telemetry?.verified_cases || 0,
    legal_tool_calls: result.telemetry?.legal_tool_calls || 0,
    search_calls: result.telemetry?.search_calls || 0,
    detail_calls: result.telemetry?.detail_calls || 0,
    tool_errors: result.telemetry?.tool_errors || 0,
    forbidden_tool_contamination: result.telemetry?.forbidden_tool_contamination || 0,
    input_tokens: result.telemetry?.input_tokens || 0,
    cached_input_tokens: result.telemetry?.cached_input_tokens || 0,
    output_tokens: result.telemetry?.output_tokens || 0,
    reasoning_tokens: result.telemetry?.reasoning_tokens ?? null,
    elapsed_ms: result.elapsed_ms || 0,
    telemetry: result.telemetry || null,
    ledger: result.ledger || null,
    ...extra,
  };
}

async function runGeminiQuestion(question, index, armDir) {
  const runtime = createAgenticSearchV2({ provider: "gemini" });
  try {
    const result = await runtime.runAgenticSearchV2(question.query);
    return recordFromResult("gemini", question, result, { plan_index: index, gateway_trace: runtime.lastRun.gateway.snapshotTrace() });
  } catch (error) {
    return { question_id: question.id, question_sha256: sha256(question.query), arm: "gemini", status: "OUTPUT_INVALID", output_valid: false, model_protocol_clean: false, selection_repaired: false, protocol_pass: false, error: safeDiagnostic(error.message), plan_index: index };
  }
}

async function runLunaQuestion(question, index, armDir) {
  const runContext = {};
  try {
    const result = await (async () => {
      const ledger = (await import("../src/aoV2/evidenceLedger.js")).createEvidenceLedger({ provider: "codex_luna" });
      const { normalizeLegalToolResult } = await import("../src/aoV2/legalToolGateway.js");
      const telemetry = (await import("../src/aoV2/telemetry.js")).createTelemetry({ provider: "codex_luna", model: MODEL, reasoningEffort: REASONING_EFFORT, questionScopeId: ledger.scopeId });
      const safety = (await import("../src/aoV2/safety.js")).createSafetyController({ wallClockMaxMs: config.aoWallClockMaxMs, legalToolMax: 100 });
      const gateway = (await import("../src/aoV2/legalToolGateway.js")).createLegalToolGateway({ ledger, telemetry, safety });
      runContext.delegatedTrace = [];
      runContext.recordDelegatedToolResult = ({ name, arguments: args, result: toolResult }) => {
        const normalized = toolResult?.items || toolResult?.caseNumber || toolResult?.rawText
          ? toolResult
          : normalizeLegalToolResult(name, toolResult || {});
        runContext.delegatedTrace.push({ accepted: !normalized?.isError, name, args: { ...(args || {}) }, result: normalized || null });
        if (!normalized || normalized.isError) return;
        if (name === "search_decisions") {
          ledger.recordDecisionSearch({ query: args?.query, domain: args?.domain, items: normalized.items || [] });
        } else if (name === "search_law") {
          ledger.recordLawSearch({ query: args?.query, items: normalized.items || [] });
        } else if (name === "get_decision_text") {
          ledger.recordDecisionDetail({ domain: args?.domain, id: args?.id, caseNumber: normalized.caseNumber, detail: normalized, rawText: normalized.rawText, verified: true });
        } else if (name === "get_law_text") {
          ledger.recordLawText({ mst: args?.mst, lawId: args?.lawId, textOpened: Boolean(normalized.rawText) });
        }
      };
      const adapter = (await import("../src/aoV2/providers/codexNativeAo.js")).createCodexNativeAo({
        gateway,
        ledger,
        telemetry,
        safety,
        createSession: createCodexSessionFactory({ armDir, questionIndex: index, runContext }),
      });
      runContext.ledger = ledger;
      runContext.gateway = gateway;
      return adapter.run(question.query);
    })();
    const resolved = await result;
    const nativeSession = runContext.session;
    const record = recordFromResult("luna", question, resolved, {
      plan_index: index,
      gateway_trace: runContext.delegatedTrace || runContext.gateway.snapshotTrace(),
      native_events: nativeSession?.events || [],
      native_stderr: safeDiagnostic(nativeSession?.stderr || ""),
      native_forbidden_events: nativeSession?.forbidden || [],
    });
    return record;
  } catch (error) {
    return { question_id: question.id, question_sha256: sha256(question.query), arm: "luna", status: "OUTPUT_INVALID", output_valid: false, model_protocol_clean: false, selection_repaired: false, protocol_pass: false, error: safeDiagnostic(error.message), plan_index: index };
  }
}

function aggregate(arm, records) {
  const count = (predicate) => records.filter(predicate).length;
  return {
    arm,
    question_count: records.length,
    strict_hit: count((row) => row.strict_hit),
    output_valid: count((row) => row.output_valid),
    model_protocol_clean: count((row) => row.model_protocol_clean),
    selection_repaired: count((row) => row.selection_repaired),
    protocol_failure: count((row) => !row.model_protocol_clean),
    output_invalid: count((row) => !row.output_valid),
    valid_related_only: count((row) => row.status === "VALID_RELATED_ONLY"),
    miss: count((row) => row.status === "MISS"),
    forbidden_tool_contamination: records.reduce((sum, row) => sum + Number(row.forbidden_tool_contamination || 0), 0),
    legal_tool_calls: records.reduce((sum, row) => sum + Number(row.legal_tool_calls || 0), 0),
    search_calls: records.reduce((sum, row) => sum + Number(row.search_calls || 0), 0),
    detail_calls: records.reduce((sum, row) => sum + Number(row.detail_calls || 0), 0),
    input_tokens: records.reduce((sum, row) => sum + Number(row.input_tokens || 0), 0),
    cached_input_tokens: records.reduce((sum, row) => sum + Number(row.cached_input_tokens || 0), 0),
    output_tokens: records.reduce((sum, row) => sum + Number(row.output_tokens || 0), 0),
    reasoning_tokens: records.reduce((sum, row) => sum + Number(row.reasoning_tokens || 0), 0),
  };
}

async function main() {
  if (!process.env.LAW_OC) throw new Error("M8_LAW_OC_MISSING");
  await fs.mkdir(PRIVATE_ROOT, { recursive: true });
  const questions = await loadQuestions();
  const startIndex = Math.max(0, Number.parseInt(process.env.M8_START_INDEX || "0", 10) || 0);
  const requestedLimit = Number.parseInt(process.env.M8_LIMIT || String(questions.length - startIndex), 10) || questions.length - startIndex;
  const runQuestions = questions.slice(startIndex, startIndex + Math.max(0, requestedLimit));
  const plan = {
    seed: SEED,
    question_ids: questions.map((question) => question.id),
    question_hashes: Object.fromEntries(questions.map((question) => [question.id, sha256(question.query)])),
    question_count: questions.length,
    start_index: startIndex,
    run_count: runQuestions.length,
    model: MODEL,
    reasoning_effort: REASONING_EFFORT,
    restricted_tools: ["search_decisions", "get_decision_text", "search_law", "get_law_text"],
    sandbox: "read-only",
  };
  plan.population = POPULATION;
  await fs.writeFile(path.join(PRIVATE_ROOT, `${ARTIFACT_PREFIX}-plan.json`), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await startMcp({ probe: true });
  const summaries = {};
  for (const arm of arms) {
    const armDir = path.join(PRIVATE_ROOT, arm);
    await fs.mkdir(armDir, { recursive: true });
    const records = [];
    for (const [index, question] of runQuestions.entries()) {
      const planIndex = startIndex + index;
      const record = arm === "gemini"
        ? await runGeminiQuestion(question, planIndex, armDir)
        : await runLunaQuestion(question, planIndex, armDir);
      records.push(record);
      await fs.appendFile(path.join(armDir, `${ARTIFACT_PREFIX}-records.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
      console.log(JSON.stringify({ checkpoint: `${CHECKPOINT_PREFIX}_QUESTION_COMPLETE`, arm, plan_index: planIndex, question_id: question.id, status: record.status, output_valid: record.output_valid, model_protocol_clean: record.model_protocol_clean, selection_repaired: record.selection_repaired }));
    }
    const result = { checkpoint: `${CHECKPOINT_PREFIX}_DIAGNOSTIC_COMPLETE`, plan, aggregate: aggregate(arm, records), records };
    summaries[arm] = result;
    await fs.writeFile(path.join(armDir, `${ARTIFACT_PREFIX}-summary.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ checkpoint: `${CHECKPOINT_PREFIX}_ARM_COMPLETE`, arm, aggregate: result.aggregate }));
  }
  await fs.writeFile(path.join(PRIVATE_ROOT, `${ARTIFACT_PREFIX}-summary.json`), `${JSON.stringify({ checkpoint: `${CHECKPOINT_PREFIX}_DIAGNOSTIC_COMPLETE`, plan, arms: summaries }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ checkpoint: `${CHECKPOINT_PREFIX}_DIAGNOSTIC_COMPLETE`, arms: Object.fromEntries(Object.entries(summaries).map(([arm, value]) => [arm, value.aggregate])) }));
  await closeMcp();
}

try {
  await main();
} finally {
  await closeMcp().catch(() => {});
}
