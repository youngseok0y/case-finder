import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, ROOT_DIR } from "../config.js";

const query = process.env.AO_EXPERIMENT_QUERY || "회사가 10년 넘게 매년 정기적으로 지급해 온 상여금을 취업규칙을 바꿔 일부 직원에게만 지급하기로 했습니다. 직원 과반수의 동의는 받지 않았는데 기존 직원에게도 새 기준을 적용할 수 있나요?";
const port = Number.parseInt(process.env.AO_EXPERIMENT_PORT || "3343", 10);
const outputPath = path.resolve(ROOT_DIR, process.env.AO_EXPERIMENT_OUTPUT || path.join("logs", "ao-single-experiment.json"));
const timeoutMs = 900_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readUsage() {
  return JSON.parse(await fs.readFile(path.join(ROOT_DIR, "state", "usage.json"), "utf8"));
}

function captureOutput(child) {
  let output = "";
  const append = (chunk) => { output = `${output}${chunk.toString()}`.slice(-8_000); };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return () => output;
}

async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT_DIR, "src", "server.js")], {
    cwd: ROOT_DIR,
    env: { ...process.env, PIPELINE_MODE: "agentic", AGENTIC_MODE: "open", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const getOutput = captureOutput(child);
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    if (child.exitCode !== null) throw new Error(`SERVER_EXITED:${child.exitCode}:${getOutput()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5_000) });
      const payload = await response.json();
      if (response.ok && payload.ok && payload.mcp?.connected) return { child, exit, getOutput };
    } catch {
      // Server or MCP child may still be starting.
    }
    await sleep(500);
  }
  throw new Error(`SERVER_START_TIMEOUT:${getOutput()}`);
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([server.exit, sleep(15_000)]);
  if (server.child.exitCode === null) server.child.kill();
}

async function ask() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    return { httpStatus: response.status, payload: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

const usageBefore = await readUsage();
let server;
let response;
try {
  server = await startServer();
  response = await ask();
} finally {
  await stopServer(server);
}
const usageAfter = await readUsage();
const result = response.payload?.result || {};
const metrics = result.agent_metrics || {};
const events = Array.isArray(result.agent_events) ? result.agent_events : [];
const byRequest = {};
for (const event of events) {
  const key = String(event.gemini_request_index);
  byRequest[key] ||= { tool_calls: 0, new_case_numbers: 0, tools: [], queries: [] };
  byRequest[key].tool_calls += 1;
  byRequest[key].new_case_numbers += Number(event.new_case_number_count || 0);
  byRequest[key].tools.push(event.tool);
  if (event.query) byRequest[key].queries.push(event.query);
}
const artifact = {
  experiment: "AO_SINGLE_CALL",
  query,
  mode: { pipeline: "agentic", agentic: "open" },
  quota: {
    before_date: usageBefore.date,
    after_date: usageAfter.date,
    before: usageBefore.callsToday,
    after: usageAfter.callsToday,
    same_day_delta: usageBefore.date === usageAfter.date ? usageAfter.callsToday - usageBefore.callsToday : null,
    pacific_date_rollover: usageBefore.date !== usageAfter.date,
  },
  http_status: response.httpStatus,
  ok: Boolean(response.payload?.ok),
  agent_stop_reason: result.agent_stop_reason || metrics.stop_reason || null,
  agent_error_reason: result.agent_error_reason || null,
  fallback_used: Boolean(result.fallback_used),
  fallback_reason: result.fallback_reason || [],
  gemini_requests: Number(metrics.gemini_requests || 0),
  mcp_calls_total: Number(metrics.mcp_calls_total || 0),
  mcp_search_calls: Number(metrics.mcp_search_calls || 0),
  mcp_detail_calls: Number(metrics.mcp_detail_calls || 0),
  elapsed_ms: Number(metrics.elapsed_ms || 0),
  raw_candidate_count: Array.isArray(result.raw_agent_candidate_set) ? result.raw_agent_candidate_set.length : 0,
  raw_selection: result.raw_agent_selection || null,
  selected_case_numbers: (result.selected || []).map((item) => item.caseNumber),
  final_verified_case_numbers: (result.items || []).filter((item) => item.status === "verified").map((item) => item.caseNumber),
  turn_summary: byRequest,
  agent_events: events,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output: outputPath,
  checkpoint: artifact.agent_stop_reason,
  rpd: artifact.quota,
  gemini_requests: artifact.gemini_requests,
  mcp_calls_total: artifact.mcp_calls_total,
  raw_candidate_count: artifact.raw_candidate_count,
  fallback_used: artifact.fallback_used,
  turn_summary: artifact.turn_summary,
}, null, 2));
