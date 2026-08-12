import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { caseNumberMatches } from "../src/router.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const goldenPath = path.join(ROOT_DIR, "test", "golden.json");
const privateDir = path.join(ROOT_DIR, "test", "private", "m7-codex-runtime");
const runLogPath = path.resolve(process.env.M7_RUN_LOG || path.join(privateDir, "m7-four-arm-runs.jsonl"));
const summaryPath = path.resolve(process.env.M7_SUMMARY || path.join(privateDir, "m7-four-arm-summary.json"));
const requestTimeoutMs = 900_000;
const serverStartupTimeoutMs = 120_000;

const arms = [
  { name: "G-D", runtime: "gemini", pipelineMode: "deterministic", agenticMode: "bounded", port: 3371 },
  { name: "L-D", runtime: "codex_cli", pipelineMode: "deterministic", agenticMode: "bounded", port: 3372 },
  { name: "G-AO", runtime: "gemini", pipelineMode: "agentic", agenticMode: "open", port: 3373 },
  { name: "L-AO", runtime: "codex_cli", pipelineMode: "agentic", agenticMode: "open", port: 3374 },
];

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function appendOutput(child) {
  let output = "";
  const append = (chunk) => { output = `${output}${chunk.toString()}`.slice(-6_000); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return () => output;
}

function expectedCases() {
  return JSON.parse(requireUnavailable());
}

function requireUnavailable() {
  throw new Error("UNUSED");
}

async function readGolden() {
  const document = JSON.parse(await fs.readFile(goldenPath, "utf8"));
  const questions = document.cases.filter((item) => item.kind === "natural" && Array.isArray(item.expectedCaseNumbers) && item.expectedCaseNumbers.length > 0);
  if (questions.length !== 17) throw new Error(`M7_GOLDEN_POPULATION_INVALID:${questions.length}`);
  return questions;
}

async function startServer(arm, dotenvPath) {
  const child = spawn(process.execPath, [path.join(ROOT_DIR, "src", "server.js")], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      MODEL_RUNTIME: arm.runtime,
      PIPELINE_MODE: arm.pipelineMode,
      AGENTIC_MODE: arm.agenticMode,
      PORT: String(arm.port),
      M6E_D_TRACE: "1",
      DOTENV_CONFIG_PATH: dotenvPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const getOutput = appendOutput(child);
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const startedAt = Date.now();
  while (Date.now() - startedAt < serverStartupTimeoutMs) {
    if (child.exitCode !== null) throw new Error(`M7_SERVER_EXITED:${arm.name}:${child.exitCode}:${getOutput()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${arm.port}/health`, { signal: AbortSignal.timeout(5_000) });
      const payload = await response.json();
      if (response.ok && payload.ok && payload.mcp?.connected) return { arm, child, exit, getOutput };
    } catch {
      // The MCP child may still be starting.
    }
    await sleep(500);
  }
  throw new Error(`M7_SERVER_START_TIMEOUT:${arm.name}:${getOutput()}`);
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([server.exit, sleep(15_000)]);
  if (server.child.exitCode === null) server.child.kill();
}

async function ask(server, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${server.arm.port}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      return { ok: false, httpStatus: response.status, message: `INVALID_JSON:${error.message}` };
    }
    return { ...payload, httpStatus: response.status };
  } catch (error) {
    return { ok: false, httpStatus: null, message: error.name === "AbortError" ? "REQUEST_TIMEOUT" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function resultMetrics(arm, result) {
  return arm.name.endsWith("D") ? result.metrics || null : result.agent_metrics || null;
}

function protocolGate(arm, question, payload) {
  const result = payload.result || {};
  const items = Array.isArray(result.items) ? result.items : [];
  const metrics = resultMetrics(arm, result);
  const verified = items.filter((item) => item.status === "verified");
  const hasGold = question.expectedCaseNumbers.some((expected) => verified.some((item) => caseNumberMatches(item.caseNumber, expected)));
  const expectedRuntime = arm.runtime;
  const telemetryComplete = arm.runtime !== "codex_cli"
    || Number(metrics?.codex_requests || 0) > 0
      && Number.isFinite(Number(metrics?.codex_input_tokens))
      && Number.isFinite(Number(metrics?.codex_output_tokens))
      && metrics?.model === "gpt-5.6-luna"
      && metrics?.reasoning_effort === "medium";
  const pass = Boolean(
    payload.ok
      && payload.httpStatus === 200
      && payload.route === "natural"
      && items.every((item) => item.status === "verified")
      && !result.fallback_used
      && metrics?.runtime === expectedRuntime
      && telemetryComplete,
  );
  return {
    pass,
    payload_ok: Boolean(payload.ok && payload.httpStatus === 200),
    all_rendered_items_verified: items.every((item) => item.status === "verified"),
    fallback_used: Boolean(result.fallback_used),
    runtime_match: metrics?.runtime === expectedRuntime,
    telemetry_complete: telemetryComplete,
    strict_gold_hit: hasGold,
    rendered_item_count: items.length,
    unverified_rendered_items: items.filter((item) => item.status !== "verified").map((item) => item.caseNumber || ""),
  };
}

function buildRecord(question, arm, payload, startedAt, orderIndex) {
  const result = payload.result || {};
  const metrics = resultMetrics(arm, result);
  const protocol = protocolGate(arm, question, payload);
  const verifiedItems = (Array.isArray(result.items) ? result.items : []).filter((item) => item.status === "verified");
  return {
    record_type: "m7_four_arm_golden",
    run_id: `${question.id}-${arm.name}-${String(orderIndex + 1).padStart(3, "0")}`,
    question_id: question.id,
    question_sha256: sha256(question.query),
    arm: arm.name,
    runtime: arm.runtime,
    architecture: arm.name.endsWith("D") ? "D" : "AO",
    status: protocol.pass ? "PASS" : "FAIL",
    protocol_gate: protocol,
    http_status: payload.httpStatus || null,
    error_message: payload.ok ? null : payload.message || "UNKNOWN_ERROR",
    expected_case_numbers: question.expectedCaseNumbers,
    final_verified_case_numbers: verifiedItems.map((item) => item.caseNumber),
    final_verified_items: verifiedItems.map((item) => ({ caseNumber: item.caseNumber, match: item.match || "", providerId: item.providerId || "", link: item.link || "" })),
    selected: result.selected || [],
    metrics,
    d_trace: result.d_trace || null,
    agent_stop_reason: result.agent_stop_reason || metrics?.stop_reason || null,
    agent_events: result.agent_events || [],
    fallback_used: Boolean(result.fallback_used || metrics?.fallback_used),
    elapsed_ms: Number(metrics?.elapsed_ms || Date.now() - startedAt),
  };
}

function summarize(records) {
  const byArm = {};
  for (const arm of arms) {
    const rows = records.filter((record) => record.arm === arm.name);
    const numeric = (key) => rows.map((row) => Number(row.metrics?.[key])).filter(Number.isFinite);
    const sum = (key) => numeric(key).reduce((total, value) => total + value, 0);
    const avg = (key) => { const values = numeric(key); return values.length ? sum(key) / values.length : null; };
    byArm[arm.name] = {
      runs: rows.length,
      protocol_pass: rows.filter((row) => row.status === "PASS").length,
      protocol_fail: rows.filter((row) => row.status !== "PASS").length,
      strict_gold: rows.filter((row) => row.protocol_gate.strict_gold_hit).length,
      strict_gold_rate: rows.length ? rows.filter((row) => row.protocol_gate.strict_gold_hit).length / rows.length : null,
      verified_output_rate: rows.length ? rows.filter((row) => row.protocol_gate.rendered_item_count > 0).length / rows.length : null,
      model_invocations: sum(arm.runtime === "codex_cli" ? "codex_requests" : "gemini_requests"),
      input_tokens: sum(arm.runtime === "codex_cli" ? "codex_input_tokens" : "gemini_input_tokens"),
      cached_input_tokens: sum("codex_cached_input_tokens"),
      output_tokens: sum(arm.runtime === "codex_cli" ? "codex_output_tokens" : "gemini_output_tokens"),
      reasoning_tokens: sum("codex_reasoning_tokens"),
      codex_credit_equivalent: sum("codex_credit_equivalent"),
      api_equivalent_usd: sum("api_equivalent_usd"),
      api_equivalent_usd_handoff_snapshot: sum("api_equivalent_usd_handoff_snapshot"),
      avg_tokens_per_question: avg(arm.runtime === "codex_cli" ? "codex_input_tokens" : "gemini_input_tokens"),
      mcp_calls_total: sum("mcp_calls_total"),
      mcp_search_calls: sum("mcp_search_calls"),
      mcp_detail_calls: sum("mcp_detail_calls"),
      avg_elapsed_ms: avg("elapsed_ms"),
      stop_reasons: Object.fromEntries(rows.map((row) => [row.agent_stop_reason || "MODEL_FINAL", rows.filter((candidate) => (candidate.agent_stop_reason || "MODEL_FINAL") === (row.agent_stop_reason || "MODEL_FINAL")).length]).filter(([key], index, all) => all.findIndex(([candidate]) => candidate === key) === index)),
    };
  }
  return byArm;
}

async function main() {
  const questions = await readGolden();
  await fs.mkdir(path.dirname(runLogPath), { recursive: true });
  try {
    await fs.access(runLogPath);
    throw new Error(`M7_RUN_LOG_EXISTS:${runLogPath}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const dotenvPath = process.env.M7_DOTENV_CONFIG_PATH || path.join(ROOT_DIR, ".env");
  const servers = [];
  const records = [];
  let failureMarker = null;
  try {
    for (const arm of arms) servers.push(await startServer(arm, dotenvPath));
    await fs.writeFile(runLogPath, "", "utf8");
    for (const [questionIndex, question] of questions.entries()) {
      const order = arms.map((_, offset) => arms[(questionIndex + offset) % arms.length]);
      for (const arm of order) {
        const server = servers.find((candidate) => candidate.arm.name === arm.name);
        const startedAt = Date.now();
        const payload = await ask(server, question.query);
        const record = buildRecord(question, arm, payload, startedAt, records.length);
        records.push(record);
        await fs.appendFile(runLogPath, `${JSON.stringify(record)}\n`, "utf8");
        console.log(JSON.stringify({ question_id: question.id, arm: arm.name, status: record.status, strict_gold_hit: record.protocol_gate.strict_gold_hit, model_invocations: record.metrics?.codex_requests || record.metrics?.gemini_requests || 0 }));
        if (record.error_message && /usage|credit|quota|limit|429|interrupted/i.test(record.error_message)) failureMarker = "M7_CODEX_USAGE_INTERRUPTED";
      }
    }
  } catch (error) {
    failureMarker ||= /usage|credit|quota|limit|429|interrupted/i.test(String(error.message)) ? "M7_CODEX_USAGE_INTERRUPTED" : "M7_PROTOCOL_INVALID";
    throw error;
  } finally {
    for (const server of servers.reverse()) await stopServer(server);
  }
  const armSummary = summarize(records);
  const allComplete = records.length === questions.length * arms.length;
  const allProtocolPass = records.every((record) => record.status === "PASS");
  const checkpoint = failureMarker || !allComplete || !allProtocolPass ? failureMarker || "M7_PROTOCOL_INVALID" : "M7_FOUR_ARM_GOLDEN_COMPLETE";
  const summary = {
    checkpoint,
    final_handoff: "CASE_FINDER_HANDOFF_M7_CODEX_LUNA_MEDIUM_BENCHMARK_FINAL.md",
    date_kst: new Date().toISOString(),
    population: { question_count: questions.length, question_ids: questions.map((question) => question.id), kind: "natural", expected_case_numbers_non_empty: true },
    arms: arms.map(({ name, runtime, pipelineMode, agenticMode }) => ({ name, runtime, pipelineMode, agenticMode })),
    rotation: "Q1 G-D -> L-D -> G-AO -> L-AO; cyclic offset per question",
    runs: { planned: questions.length * arms.length, completed: records.length, protocol_pass: records.filter((record) => record.status === "PASS").length, protocol_fail: records.filter((record) => record.status !== "PASS").length },
    pricing: { codex_credit_rates_per_million: { input: 25, cached_input: 2.5, output: 150 }, api_equivalent_current_per_million: { input: 0.2, cached_input: 0.02, output: 1.2 }, api_equivalent_handoff_snapshot_per_million: { input: 1, cached_input: 0.1, output: 6 }, reasoning_tokens_not_double_billed: true },
    arm_summary: armSummary,
    source: { golden: "test/golden.json", run_log: path.relative(ROOT_DIR, runLogPath), summary: path.relative(ROOT_DIR, summaryPath) },
    next_step: checkpoint === "M7_FOUR_ARM_GOLDEN_COMPLETE" ? "M7_USER_REVIEW_REQUIRED; do not start PH automatically." : "Investigate protocol or usage interruption before any continuation.",
  };
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ checkpoint, summary: summaryPath, run_log: runLogPath, arm_summary: armSummary }, null, 2));
}

await main();
