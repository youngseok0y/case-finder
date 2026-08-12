import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, ROOT_DIR } from "../config.js";
import { decisionDetailLink } from "../src/directLookup.js";

const holdoutPrefix = process.env.HOLDOUT_PREFIX || "M6D";
const privateDir = path.resolve(ROOT_DIR, process.env.HOLDOUT_PRIVATE_DIR || path.join("test", "private", "m6d-holdout"));
const questionsPath = path.join(privateDir, process.env.HOLDOUT_QUESTIONS_FILE || "questions.json");
const runLogPath = path.resolve(ROOT_DIR, process.env.HOLDOUT_RUN_LOG || path.join("logs", "m6d-private-holdout-runs.jsonl"));
const summaryPath = path.resolve(ROOT_DIR, process.env.HOLDOUT_SUMMARY || path.join("logs", "m6d-private-holdout-run-summary.json"));
const armComparisonPath = path.resolve(ROOT_DIR, process.env.HOLDOUT_ARM_COMPARISON || path.join("logs", "m6d-private-holdout-arm-comparison.json"));
const blindPacketPath = path.join(privateDir, "blind_packet.json");
const unmaskKeyPath = path.join(privateDir, "unmask_key.json");
const packetId = process.env.HOLDOUT_PACKET_ID || "M6D_PRIVATE_HOLDOUT_2026-08-12";
const reviewerInstructions = process.env.HOLDOUT_REVIEWER_INSTRUCTIONS || "docs/CASE_FINDER_M6D_PRIVATE_BLIND_REVIEW_INSTRUCTIONS.md";
const successCheckpoint = process.env.HOLDOUT_SUCCESS_CHECKPOINT || "M6D_AWAITING_EXTERNAL_BLIND_REVIEW";
const invalidCheckpoint = process.env.HOLDOUT_INVALID_CHECKPOINT || "M6D_PROTOCOL_INVALID";
const expectedQuestionCount = Number.parseInt(process.env.HOLDOUT_QUESTION_COUNT || "10", 10);
const expectedInitialRpd = Number.parseInt(process.env.HOLDOUT_INITIAL_RPD || "0", 10);
const providerInitialRpd = Number.parseInt(process.env.HOLDOUT_PROVIDER_INITIAL_RPD || String(expectedInitialRpd), 10);
const questionIdPattern = new RegExp(process.env.HOLDOUT_ID_PATTERN || "^MH\\d{2}$", "u");
const port = Number.parseInt(process.env.HOLDOUT_PORT || "3341", 10);
const requestTimeoutMs = 900_000;
const localRpdLimit = config.geminiRpdLimit;
const safeReserve = 30;
const providerRpdLimit = 500;

const arms = [
  { name: "D", pipelineMode: "deterministic", agenticMode: "bounded" },
  { name: "A6", pipelineMode: "agentic", agenticMode: "bounded" },
  { name: "AO", pipelineMode: "agentic", agenticMode: "open" },
];

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length === 0 ? null : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function resolveVerifiedItemLink(rawCandidates, item) {
  if (item.link) return item.link;
  const candidate = rawCandidates.find((entry) => String(entry.id || "") === String(item.providerId || ""));
  return candidate ? decisionDetailLink(candidate.domain, item.providerId) : "";
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readUsage() {
  try {
    return await readJson(path.join(ROOT_DIR, "state", "usage.json"));
  } catch {
    return { date: "", callsToday: 0, recentCalls: [] };
  }
}

function validateQuestions(document) {
  if (document.status !== "FROZEN" || !Array.isArray(document.questions) || document.questions.length !== expectedQuestionCount) {
    throw new Error(`${holdoutPrefix}_PRIVATE_INPUT_INVALID`);
  }
  const ids = new Set();
  for (const question of document.questions) {
    if (!questionIdPattern.test(question.question_id) || ids.has(question.question_id)) {
      throw new Error(`${holdoutPrefix}_PRIVATE_INPUT_INVALID`);
    }
    ids.add(question.question_id);
    if (!question.query || sha256(question.query) !== question.question_sha256) {
      throw new Error(`${holdoutPrefix}_PRIVATE_HASH_MISMATCH:${question.question_id}`);
    }
    if (question.char_count !== [...question.query].length) {
      throw new Error(`${holdoutPrefix}_PRIVATE_CHAR_COUNT_MISMATCH:${question.question_id}`);
    }
  }
}

function childOutput(child) {
  let output = "";
  const append = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-8_000);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return () => output;
}

async function startServer(arm) {
  const child = spawn(process.execPath, [path.join(ROOT_DIR, "src", "server.js")], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PIPELINE_MODE: arm.pipelineMode,
      AGENTIC_MODE: arm.agenticMode,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const getOutput = childOutput(child);
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    if (child.exitCode !== null) {
      throw new Error(`SERVER_EXITED:${arm.name}:${child.exitCode}:${getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5_000) });
      const payload = await response.json();
      if (response.ok && payload.ok && payload.mcp?.connected) return { child, exit, getOutput };
    } catch {
      // The server or MCP child may still be starting.
    }
    await sleep(500);
  }
  throw new Error(`SERVER_START_TIMEOUT:${arm.name}:${getOutput()}`);
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([server.exit, sleep(15_000)]);
  if (server.child.exitCode === null) server.child.kill();
}

async function ask(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      return { ok: false, message: `INVALID_JSON:${error.message}`, httpStatus: response.status };
    }
    return { ...payload, httpStatus: response.status };
  } catch (error) {
    return { ok: false, message: error.name === "AbortError" ? "REQUEST_TIMEOUT" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function resultMetrics(arm, result) {
  return arm.name === "D" ? result.metrics || null : result.agent_metrics || null;
}

function protocolGate(payload) {
  const result = payload.result || {};
  const items = Array.isArray(result.items) ? result.items : [];
  const unverifiedRenderedItems = items.filter((item) => item.status !== "verified");
  return {
    payload_ok: Boolean(payload.ok && payload.httpStatus === 200),
    nonempty_output: items.length > 0,
    unverified_rendered_items: unverifiedRenderedItems.map((item) => item.caseNumber || ""),
    pass: Boolean(payload.ok && payload.httpStatus === 200 && unverifiedRenderedItems.length === 0),
  };
}

function finalItems(result) {
  return (Array.isArray(result.items) ? result.items : []).map((item) => ({
    providerId: String(item.providerId || ""),
    caseNumber: item.caseNumber || "",
    status: item.status || "",
    match: item.match || "",
    link: item.link || "",
  }));
}

function runRecord({ question, arm, payload, startedAt, usageBefore, usageAfter, runId }) {
  const result = payload.result || {};
  const metrics = resultMetrics(arm, result);
  const gate = protocolGate(payload);
  const items = finalItems(result);
  return {
    record_type: "m6d_private_holdout",
    run_id: runId,
    question_id: question.question_id,
    question_sha256: question.question_sha256,
    query: question.query,
    arm: arm.name,
    status: gate.pass ? "PASS" : "FAIL",
    protocol_gate: gate,
    http_status: payload.httpStatus || null,
    error_message: payload.ok ? null : payload.message || "UNKNOWN_ERROR",
    raw_agent_candidate_set: result.raw_agent_candidate_set || result.raw_agent_candidates || [],
    raw_agent_selection: result.raw_agent_selection || null,
    fallback_candidate_set: result.fallback_candidate_set || [],
    final_verified_items: items
      .filter((item) => item.status === "verified")
      .map((item) => ({ ...item, link: resolveVerifiedItemLink(result.raw_agent_candidate_set || result.raw_agent_candidates || [], item) })),
    final_product_output: result.final_product_output || {
      route: result.route || "natural",
      query: result.query || question.query,
      selected: result.selected || [],
      items,
      validationFailures: result.validationFailures || [],
    },
    final_verified_case_numbers: items.filter((item) => item.status === "verified").map((item) => item.caseNumber),
    gemini_requests: Number(metrics?.gemini_requests || 0),
    gemini_retry_requests: Number(metrics?.gemini_retry_requests || 0),
    gemini_input_tokens: Number(metrics?.gemini_input_tokens || 0),
    gemini_output_tokens: Number(metrics?.gemini_output_tokens || 0),
    gemini_rpm_wait_events: Number(metrics?.gemini_rpm_wait_events || 0),
    gemini_rpm_wait_ms: Number(metrics?.gemini_rpm_wait_ms || 0),
    mcp_calls_total: Number(metrics?.mcp_calls_total || 0),
    mcp_search_calls: Number(metrics?.mcp_search_calls || 0),
    mcp_detail_calls: Number(metrics?.mcp_detail_calls || 0),
    elapsed_ms: Number(metrics?.elapsed_ms || Date.now() - startedAt),
    agent_stop_reason: result.agent_stop_reason || metrics?.stop_reason || null,
    agent_error_reason: result.agent_error_reason || null,
    fallback_used: Boolean(result.fallback_used || metrics?.fallback_used),
    fallback_reason: result.fallback_reason || [],
    local_rpd: {
      before: Number(usageBefore.callsToday || 0),
      after: Number(usageAfter.callsToday || 0),
      limit: localRpdLimit,
    },
    run_elapsed_ms: Date.now() - startedAt,
    agent_events: result.agent_events || [],
  };
}

function buildArmSummary(records) {
  const summary = {};
  for (const arm of arms) {
    const rows = records.filter((record) => record.arm === arm.name);
    const requests = rows.map((row) => row.gemini_requests);
    const rpmWaitEvents = rows.map((row) => row.gemini_rpm_wait_events);
    const rpmWaitMs = rows.map((row) => row.gemini_rpm_wait_ms);
    const mcpCalls = rows.map((row) => row.mcp_calls_total);
    const elapsed = rows.map((row) => row.elapsed_ms);
    const avgRequests = average(requests);
    const stopReasons = {};
    for (const row of rows) {
      const reason = row.agent_stop_reason || (row.status === "PASS" ? "MODEL_FINAL" : "ERROR");
      stopReasons[reason] = (stopReasons[reason] || 0) + 1;
    }
    summary[arm.name] = {
      runs: rows.length,
      protocol_pass: rows.filter((row) => row.status === "PASS").length,
      protocol_fail: rows.filter((row) => row.status !== "PASS").length,
      nonempty_outputs: rows.filter((row) => row.final_verified_items.length > 0).length,
      all_rendered_items_verified: rows.every((row) => row.protocol_gate.unverified_rendered_items.length === 0),
      total_gemini_requests: requests.reduce((sum, value) => sum + value, 0),
      avg_gemini_requests: avgRequests,
      median_gemini_requests: percentile(requests, 0.5),
      p90_gemini_requests: percentile(requests, 0.9),
      max_gemini_requests: requests.length > 0 ? Math.max(...requests) : null,
      total_retry_requests: rows.reduce((sum, row) => sum + row.gemini_retry_requests, 0),
      avg_rpm_wait_events: average(rpmWaitEvents),
      total_rpm_wait_events: rpmWaitEvents.reduce((sum, value) => sum + value, 0),
      avg_rpm_wait_ms: average(rpmWaitMs),
      total_rpm_wait_ms: rpmWaitMs.reduce((sum, value) => sum + value, 0),
      total_mcp_calls: mcpCalls.reduce((sum, value) => sum + value, 0),
      avg_mcp_calls: average(mcpCalls),
      avg_elapsed_ms: average(elapsed),
      median_elapsed_ms: percentile(elapsed, 0.5),
      p90_elapsed_ms: percentile(elapsed, 0.9),
      max_elapsed_ms: elapsed.length > 0 ? Math.max(...elapsed) : null,
      theoretical_daily_capacity: avgRequests > 0 ? Math.floor(localRpdLimit / avgRequests) : null,
      safe_daily_capacity: avgRequests > 0 ? Math.floor((localRpdLimit - safeReserve) / avgRequests) : null,
      stop_reasons: stopReasons,
      rpm_limit_stop_count: rows.filter((row) => row.agent_stop_reason === "RPM_LIMIT_STOP").length,
      fallback_rate: rows.length === 0 ? null : rows.filter((row) => row.fallback_used).length / rows.length,
    };
  }
  return summary;
}

function buildBlindArtifacts(questions, records) {
  const samples = [];
  const unmask = [];
  const byKey = new Map();
  for (const question of questions) {
    const questionRecords = records.filter((record) => record.question_id === question.question_id);
    for (const record of questionRecords) {
      for (const [rankIndex, item] of record.final_verified_items.entries()) {
        const providerId = String(item.providerId || "");
        const sourceLocator = String(item.link || "");
        if (!providerId || !sourceLocator) continue;
        const key = `${question.question_id}|${providerId}`;
        let sample = byKey.get(key);
        if (!sample) {
          sample = {
            sample_id: `${question.question_id}-S${String(samples.length + 1).padStart(3, "0")}`,
            question_id: question.question_id,
            question_text: question.query,
            provider_id: providerId,
            source_locator: sourceLocator,
          };
          byKey.set(key, sample);
          samples.push(sample);
          unmask.push({
            sample_id: sample.sample_id,
            question_id: question.question_id,
            provider_id: providerId,
            arms: [],
            rank_by_arm: {},
          });
        }
        const keyEntry = unmask.find((entry) => entry.sample_id === sample.sample_id);
        if (!keyEntry.arms.includes(record.arm)) keyEntry.arms.push(record.arm);
        keyEntry.rank_by_arm[record.arm] = rankIndex + 1;
      }
    }
  }
  return {
    packet: {
      schema_version: "m6d-blind-packet-v1",
      packet_id: packetId,
      reviewer_instructions: reviewerInstructions,
      samples,
    },
    unmask: {
      schema_version: "m6d-unmask-key-v1",
      packet_id: packetId,
      samples: unmask,
    },
  };
}

async function main() {
  const executeMode = process.argv.includes("--execute");
  const rebuildMode = process.argv.includes("--rebuild");
  if (!executeMode && !rebuildMode) {
    console.log(`${holdoutPrefix} private holdout runner: pass --execute to run or --rebuild to regenerate artifacts from an existing run log.`);
    return;
  }
  const questionsDocument = await readJson(questionsPath);
  validateQuestions(questionsDocument);
  if (executeMode) {
    const initialUsage = await readUsage();
    if (Number(initialUsage.callsToday || 0) !== expectedInitialRpd) {
      throw new Error(`${holdoutPrefix}_RPD_BASELINE_MISMATCH:${JSON.stringify({ expected: expectedInitialRpd, actual: initialUsage })}`);
    }
  }
  await fs.mkdir(path.dirname(runLogPath), { recursive: true });
  if (executeMode) {
    try {
      await fs.access(runLogPath);
      throw new Error(`${holdoutPrefix}_RUN_LOG_EXISTS:${runLogPath}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.writeFile(runLogPath, "", "utf8");
  }
  let records;
  const runStartedAt = Date.now();
  if (rebuildMode) {
    const rawLog = await fs.readFile(runLogPath, "utf8");
    records = rawLog.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    for (const record of records) {
      record.final_verified_items = (record.final_verified_items || []).map((item) => ({
        ...item,
        link: resolveVerifiedItemLink(record.raw_agent_candidate_set || [], item),
      }));
    }
    await fs.writeFile(runLogPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
  } else {
    records = [];
    for (const [questionIndex, question] of questionsDocument.questions.entries()) {
      const order = arms.map((_, offset) => arms[(questionIndex + offset) % arms.length]);
      for (const arm of order) {
        const runId = `${question.question_id}-${arm.name}-${String(records.length + 1).padStart(2, "0")}`;
        const usageBefore = await readUsage();
        if (Number(usageBefore.callsToday || 0) >= localRpdLimit) throw new Error(`${holdoutPrefix}_RPD_LIMIT_REACHED:${runId}`);
        const startedAt = Date.now();
        let payload;
        let server;
        try {
          server = await startServer(arm);
          payload = await ask(question.query);
        } catch (error) {
          payload = { ok: false, message: error.message, httpStatus: null };
        } finally {
          await stopServer(server);
        }
        const usageAfter = await readUsage();
        const record = runRecord({ question, arm, payload, startedAt, usageBefore, usageAfter, runId });
        records.push(record);
        await fs.appendFile(runLogPath, `${JSON.stringify(record)}\n`, "utf8");
        console.log(JSON.stringify({
          question_id: question.question_id,
          arm: arm.name,
          status: record.status,
          gemini_requests: record.gemini_requests,
          local_rpd: usageAfter.callsToday,
          rpm_wait_ms: record.gemini_rpm_wait_ms,
        }));
      }
    }
  }

  const finalUsage = await readUsage();
  const armSummary = buildArmSummary(records);
  const artifacts = buildBlindArtifacts(questionsDocument.questions, records);
  const packetIssues = records.flatMap((record) => record.final_verified_items
    .filter((item) => !item.providerId || !item.link)
    .map((item) => ({ run_id: record.run_id, case_number: item.caseNumber, missing_provider_id: !item.providerId, missing_source_locator: !item.link })));
  const plannedRuns = expectedQuestionCount * arms.length;
  const rpdHardStopCount = records.filter((record) => ["RPD_LIMIT_STOP", "RPD_RESERVE_STOP"].includes(record.agent_stop_reason)).length;
  const protocolInvalid = records.length !== plannedRuns
    || records.some((record) => record.status !== "PASS")
    || packetIssues.length > 0
    || Object.values(armSummary).some((summary) => summary.rpm_limit_stop_count > 0)
    || rpdHardStopCount > 0;
  const checkpoint = protocolInvalid ? invalidCheckpoint : successCheckpoint;
  const summary = {
    checkpoint,
    packet_status: protocolInvalid ? "HOLD" : "READY_FOR_EXTERNAL_REVIEW",
    packet_id: artifacts.packet.packet_id,
    input: {
      question_count: questionsDocument.questions.length,
      question_ids: questionsDocument.questions.map((question) => question.question_id),
      hashes_frozen: true,
      question_text_tracked: false,
    },
    quota: {
      local_rpd: { initial: expectedInitialRpd, limit: localRpdLimit, final: Number(finalUsage.callsToday || 0) },
      provider_rpd: { initial: providerInitialRpd, limit: providerRpdLimit, independently_observable: false },
      rpm_limit: config.geminiRpmLimit,
      rpm_wait_margin_ms: config.geminiRpmWaitMarginMs,
      ao_rpd_reserve: config.aoRpdReserve,
      planned_runs: plannedRuns,
    },
    runs: {
      total: records.length,
      pass: records.filter((record) => record.status === "PASS").length,
      fail: records.filter((record) => record.status !== "PASS").length,
      rpm_limit_stop_count: records.filter((record) => record.agent_stop_reason === "RPM_LIMIT_STOP").length,
      rpd_hard_stop_count: rpdHardStopCount,
      total_gemini_requests: records.reduce((sum, record) => sum + record.gemini_requests, 0),
      total_rpm_wait_events: records.reduce((sum, record) => sum + record.gemini_rpm_wait_events, 0),
      total_rpm_wait_ms: records.reduce((sum, record) => sum + record.gemini_rpm_wait_ms, 0),
      elapsed_ms: Date.now() - runStartedAt,
    },
    arm_summary: armSummary,
    packet: {
      sample_count: artifacts.packet.samples.length,
      packet_path: path.relative(ROOT_DIR, blindPacketPath),
      unmask_key_path: path.relative(ROOT_DIR, unmaskKeyPath),
      packet_issues: packetIssues,
    },
    next_step: protocolInvalid ? "Investigate protocol failure before reviewer handoff." : "External reviewer may evaluate the blind packet; do not unmask yet.",
  };
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await fs.writeFile(armComparisonPath, `${JSON.stringify({ checkpoint, packet_id: artifacts.packet.packet_id, arm_summary: armSummary, quality: "awaiting_external_blind_review" }, null, 2)}\n`, "utf8");
  await fs.writeFile(blindPacketPath, `${JSON.stringify(artifacts.packet, null, 2)}\n`, "utf8");
  await fs.writeFile(unmaskKeyPath, `${JSON.stringify(artifacts.unmask, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ checkpoint, summary: summaryPath, blind_packet: blindPacketPath, samples: artifacts.packet.samples.length }, null, 2));
}

await main();
