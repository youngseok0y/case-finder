import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { caseNumberMatches } from "../src/router.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(await fs.readFile(path.join(currentDir, "golden.json"), "utf8"));

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/$/u, "");
}

const arms = [
  { name: "D", baseUrl: normalizeBaseUrl(option("d-url", "http://127.0.0.1:3331")) },
  { name: "A6", baseUrl: normalizeBaseUrl(option("a6-url", "http://127.0.0.1:3332")) },
  { name: "AO", baseUrl: normalizeBaseUrl(option("ao-url", "http://127.0.0.1:3333")) },
];
const timeoutMs = Math.max(5_000, Number.parseInt(option("timeout-ms", "700000"), 10) || 700_000);
const externalBaselineUsed = Math.max(0, Number.parseInt(option("quota-baseline", "0"), 10) || 0);
const externalLimit = Math.max(1, Number.parseInt(option("quota-limit", "500"), 10) || 500);
const externalReserve = Math.max(0, Number.parseInt(option("quota-reserve", "30"), 10) || 30);
const rpmLimit = Math.max(1, Number.parseInt(option("rpm-limit", "13"), 10) || 13);
const rpmWindowMs = Math.max(1_000, Number.parseInt(option("rpm-window-ms", "60000"), 10) || 60_000);
const startIndex = Math.max(0, Number.parseInt(option("start", "0"), 10) || 0);
const requestedLimit = Number.parseInt(option("limit", String(golden.cases.length)), 10);
const limit = Number.isInteger(requestedLimit) && requestedLimit >= 0
  ? Math.min(requestedLimit, golden.cases.length - startIndex)
  : golden.cases.length - startIndex;
const selectedCases = golden.cases.slice(startIndex, startIndex + limit);
const outputPath = path.resolve(option("output", path.join("logs", "m6c-screening-2026-08-11.jsonl")));

function expectedNumbers(testCase) {
  return Array.isArray(testCase.expectedCaseNumbers) ? testCase.expectedCaseNumbers : [];
}

function recall(observed, expected) {
  if (expected.length === 0) return null;
  const matches = expected.filter((gold) => observed.some((value) => caseNumberMatches(String(value || ""), gold)));
  return matches.length / expected.length;
}

function caseNumbersFromItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => item.caseNumber).filter(Boolean);
}

function protocolErrors(testCase, payload) {
  const result = payload?.result || {};
  const items = Array.isArray(result.items) ? result.items : [];
  const errors = [];
  if (!payload?.ok) errors.push(`http_or_payload_error:${payload?.message || "unknown"}`);
  const expectedRoute = testCase.kind === "direct" ? "direct" : testCase.kind === "natural" ? "natural" : null;
  if (expectedRoute && payload.route !== expectedRoute) errors.push(`route:${payload.route || "missing"}`);
  if (testCase.expectNoItems && items.length !== 0) errors.push(`expected_no_items:${items.length}`);
  if (testCase.minItems !== undefined && items.length < testCase.minItems) errors.push(`min_items:${items.length}<${testCase.minItems}`);
  if (testCase.expectedCaseNumbers?.length && !testCase.expectedCaseNumbers.some((gold) => items.some((item) => caseNumberMatches(item.caseNumber, gold)))) {
    errors.push("expected_case_not_in_output");
  }
  if (testCase.forbiddenCaseNumbers?.some((gold) => items.some((item) => caseNumberMatches(item.caseNumber, gold)))) {
    errors.push("forbidden_case_in_output");
  }
  if (testCase.requireCaseLinks && !items.every((item) => item.link)) errors.push("missing_case_link");
  if (/[?&]OC=/iu.test(String(payload.html || ""))) errors.push("oc_leak_in_html");
  return errors;
}

function metricsFor(arm, result) {
  if (arm.name === "D") return result.metrics || null;
  return result.agent_metrics || null;
}

function selectedFor(arm, result) {
  if (arm.name === "D") return caseNumbersFromItems(result.selected);
  return (result.raw_agent_selection?.selected || []).map((item) => item.case_no).filter(Boolean);
}

function candidateSetFor(arm, result) {
  if (arm.name === "D") return result.candidateCaseNumbers || [];
  return (result.raw_agent_candidate_set || result.raw_agent_candidates || []).map((item) => item.caseNumber).filter(Boolean);
}

function fallbackSetFor(result) {
  return (result.fallback_candidate_set || []).map((item) => item.caseNumber).filter(Boolean);
}

async function ask(arm, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${arm.baseUrl}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      return { ok: false, message: `invalid_json:${error.message}`, status: response.status };
    }
    return { ...payload, httpStatus: response.status };
  } catch (error) {
    return { ok: false, message: error.name === "AbortError" ? "request_timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

let plannedGeminiCalls = [];

async function waitForRpmBudget(expectedRequests) {
  const startedAt = Date.now();
  const requested = Math.max(1, expectedRequests);
  while (true) {
    const now = Date.now();
    plannedGeminiCalls = plannedGeminiCalls.filter((timestamp) => timestamp > now - rpmWindowMs);
    if (plannedGeminiCalls.length + requested <= rpmLimit) break;
    const waitMs = Math.max(250, plannedGeminiCalls[0] + rpmWindowMs - now + 100);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return Date.now() - startedAt;
}

function expectedGeminiRequests(arm, testCase) {
  if (testCase.kind === "direct") return 0;
  return arm.name === "D" ? 2 : 6;
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, "", "utf8");

let externalGeminiUsed = externalBaselineUsed;
let completed = 0;
let skippedByQuota = 0;
const summary = { D: { runs: 0, valid: 0 }, A6: { runs: 0, valid: 0 }, AO: { runs: 0, valid: 0 } };

for (let caseIndex = 0; caseIndex < selectedCases.length; caseIndex += 1) {
  const testCase = selectedCases[caseIndex];
  const order = arms.map((_, offset) => arms[(caseIndex + offset) % arms.length]);
  for (const arm of order) {
    if (externalGeminiUsed >= externalLimit - externalReserve) {
      skippedByQuota += 1;
      const skippedRecord = {
        record_type: "m6c_screening",
        suite: golden.version,
        case_id: testCase.id,
        arm: arm.name,
        query: testCase.query,
        status: "SKIPPED_QUOTA_GUARD",
        external_rpd: { baseline_used: externalBaselineUsed, observed_used: externalGeminiUsed, limit: externalLimit, reserve: externalReserve },
      };
      await fs.appendFile(outputPath, `${JSON.stringify(skippedRecord)}\n`, "utf8");
      continue;
    }

    const startedAt = Date.now();
    const runnerRpmWaitMs = expectedGeminiRequests(arm, testCase) > 0
      ? await waitForRpmBudget(expectedGeminiRequests(arm, testCase))
      : 0;
    const payload = await ask(arm, testCase.query);
    const result = payload.result || {};
    const metrics = metricsFor(arm, result);
    const requestCount = Number(metrics?.gemini_requests || 0);
    externalGeminiUsed += Number.isFinite(requestCount) ? requestCount : 0;
    for (let index = 0; index < requestCount; index += 1) plannedGeminiCalls.push(Date.now());
    const expected = expectedNumbers(testCase);
    const candidateSet = candidateSetFor(arm, result);
    const fallbackSet = fallbackSetFor(result);
    const rawSelection = arm.name === "D" ? null : result.raw_agent_selection || null;
    const events = (result.agent_events || []).map((event) => ({
      ...event,
      candidate_gold_seen: expected.some((gold) => (event.returned_case_numbers || []).some((value) => caseNumberMatches(value, gold))),
      selected_gold_seen: expected.some((gold) => (rawSelection?.selected || []).some((item) => caseNumberMatches(item.case_no, gold))),
    }));
    const errors = protocolErrors(testCase, payload);
    const verifiedItems = (result.items || []).filter((item) => item.status === "verified").length;
    const itemCount = Array.isArray(result.items) ? result.items.length : 0;
    const record = {
      record_type: "m6c_screening",
      suite: golden.version,
      case_id: testCase.id,
      kind: testCase.kind,
      query: testCase.query,
      arm: arm.name,
      base_url: arm.baseUrl,
      status: errors.length === 0 ? "PASS" : "FAIL",
      protocol_errors: errors,
      elapsed_ms: Date.now() - startedAt,
      runner_rpm_wait_ms: runnerRpmWaitMs,
      metrics,
      agent_stop_reason: result.agent_stop_reason || null,
      agent_error_reason: result.agent_error_reason || null,
      fallback_used: Boolean(result.fallback_used),
      fallback_reason: result.fallback_reason || [],
      external_rpd: { baseline_used: externalBaselineUsed, observed_used: externalGeminiUsed, limit: externalLimit, reserve: externalReserve },
      expected_case_numbers: expected,
      raw_agent_candidate_set: result.raw_agent_candidate_set || result.raw_agent_candidates || [],
      raw_agent_selection: rawSelection,
      fallback_candidate_set: result.fallback_candidate_set || [],
      candidate_recall: recall(candidateSet, expected),
      fallback_candidate_recall: recall(fallbackSet, expected),
      raw_agent_selection_recall: rawSelection ? recall(selectedFor(arm, result), expected) : null,
      final_selection_recall: recall(caseNumbersFromItems(result.items), expected),
      verified_item_rate: itemCount === 0 ? null : verifiedItems / itemCount,
      final_product_output: result.final_product_output || null,
      agent_events: events,
    };
    await fs.appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
    completed += 1;
    summary[arm.name].runs += 1;
    if (record.status === "PASS") summary[arm.name].valid += 1;
    console.log(JSON.stringify({ case_id: testCase.id, arm: arm.name, status: record.status, gemini_requests: requestCount, external_rpd_used: externalGeminiUsed }));
  }
}

console.log(JSON.stringify({
  suite: golden.version,
  output: outputPath,
  cases: selectedCases.length,
  completed,
  skipped_by_quota: skippedByQuota,
  external_rpd: { baseline_used: externalBaselineUsed, observed_used: externalGeminiUsed, limit: externalLimit, reserve: externalReserve },
  summary,
}, null, 2));
