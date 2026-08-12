import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { caseNumberMatches } from "../src/router.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(currentDir);
const entrySha = "df28007c52cd48fdb8fd5066ee4bdf209a42b0ff";
const rawLogNames = [
  "m6c-screening-clean2-2026-08-11.jsonl",
  "m6c-screening-clean2-tail2-2026-08-11.jsonl",
  "m6c-screening-session2-tail-2026-08-11.jsonl",
];
const arms = ["D", "A6", "AO"];
const thresholds = [2, 4, 6, 8, 10, 12, ">12"];

function fail(message) {
  const error = new Error(message);
  error.code = "M6D_BASELINE_INPUT_INVALID";
  throw error;
}

function average(values) {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(values, probability) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value) {
  return value === null || value === undefined ? null : Math.round(value * 1000) / 1000;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function expectedNumbers(record) {
  return Array.isArray(record.expected_case_numbers) ? record.expected_case_numbers.filter(Boolean) : [];
}

function hasExpected(record) {
  return expectedNumbers(record).length > 0;
}

function metric(record, name) {
  return finiteNumber(record.metrics?.[name]);
}

function finalItems(record) {
  return Array.isArray(record.final_product_output?.items) ? record.final_product_output.items : [];
}

function outputEvidence(record) {
  const items = finalItems(record);
  if (items.length > 0) {
    const verifiedItems = items.filter((item) => item.status === "verified").length;
    return {
      nonempty: true,
      verified: verifiedItems === items.length,
      verifiedItemRate: verifiedItems / items.length,
      source: "final_product_output",
    };
  }
  if (record.verified_item_rate !== null && record.verified_item_rate !== undefined) {
    return {
      nonempty: true,
      verified: finiteNumber(record.verified_item_rate) === 1,
      verifiedItemRate: finiteNumber(record.verified_item_rate),
      source: "runner_verified_item_rate_proxy",
    };
  }
  return { nonempty: false, verified: false, verifiedItemRate: null, source: "unavailable" };
}

function isVerifiedOutput(record) {
  const evidence = outputEvidence(record);
  return evidence.nonempty && evidence.verified;
}

function finalHit(record) {
  return finiteNumber(record.final_selection_recall, 0) > 0;
}

function anyHit(record, field) {
  return finiteNumber(record[field], 0) > 0;
}

function protocolErrors(records) {
  const counts = {};
  for (const record of records) {
    for (const error of record.protocol_errors || []) counts[error] = (counts[error] || 0) + 1;
  }
  return counts;
}

function stopReason(record) {
  return record.agent_stop_reason || record.metrics?.stop_reason || "NONE";
}

function stopReasons(records) {
  const counts = {};
  for (const record of records) {
    const reason = stopReason(record);
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function fallbackReasons(records) {
  const counts = {};
  for (const record of records) {
    for (const reason of record.fallback_reason || []) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function recallStats(records, field) {
  const eligible = records.filter(hasExpected);
  const values = eligible.map((record) => finiteNumber(record[field])).filter(Number.isFinite);
  return {
    denominator: eligible.length,
    mean: round(average(values)),
    anyHitRate: round(eligible.length === 0 ? null : eligible.filter((record) => anyHit(record, field)).length / eligible.length),
  };
}

function populationSummary(records) {
  const evidence = records.map((record) => outputEvidence(record));
  const nonempty = evidence.filter((item) => item.nonempty);
  const explicitItems = nonempty.filter((item) => item.source === "final_product_output");
  const proxyRates = nonempty.filter((item) => item.source === "runner_verified_item_rate_proxy").map((item) => item.verifiedItemRate);
  const itemCount = sum(records.map((record) => finalItems(record).length));
  const verifiedItemCount = sum(records.map((record) => finalItems(record).filter((item) => item.status === "verified").length));
  const explicitRate = itemCount > 0 ? verifiedItemCount / itemCount : null;
  return {
    records: records.length,
    protocolPass: records.filter((record) => record.status === "PASS").length,
    protocolPassRate: round(records.length === 0 ? null : records.filter((record) => record.status === "PASS").length / records.length),
    emptyGoldRecords: records.filter((record) => !hasExpected(record)).length,
    expectedGoldRecords: records.filter(hasExpected).length,
    nonemptyFinalRecords: nonempty.length,
    verifiedNonemptyOutputRecords: nonempty.filter((item) => item.verified).length,
    verifiedNonemptyOutputRate: round(nonempty.length === 0 ? null : nonempty.filter((item) => item.verified).length / nonempty.length),
    verifiedItemRate: round(explicitRate === null ? average(proxyRates) : explicitRate),
    verifiedItemRateSource: explicitRate === null
      ? (proxyRates.length > 0 ? "runner_verified_item_rate_proxy" : "unavailable")
      : (proxyRates.length > 0 ? "mixed" : "final_product_output"),
    explicitItemOutputRecords: explicitItems.length,
    protocolErrors: protocolErrors(records),
  };
}

function quotaStats(records) {
  const requests = records.map((record) => metric(record, "gemini_requests"));
  const retries = records.map((record) => metric(record, "gemini_retry_requests"));
  const mcpCalls = records.map((record) => metric(record, "mcp_calls_total"));
  const elapsed = records.map((record) => metric(record, "elapsed_ms") || finiteNumber(record.elapsed_ms));
  const totalRequests = sum(requests);
  return {
    totalGeminiRequests: totalRequests,
    avgGeminiRequests: round(average(requests)),
    medianGeminiRequests: round(quantile(requests, 0.5)),
    p90GeminiRequests: round(quantile(requests, 0.9)),
    maxGeminiRequests: requests.length ? Math.max(...requests) : null,
    totalRetryRequests: sum(retries),
    retryRate: round(totalRequests === 0 ? null : sum(retries) / totalRequests),
    totalMcpCalls: sum(mcpCalls),
    avgMcpCalls: round(average(mcpCalls)),
    avgElapsedMs: round(average(elapsed)),
    medianElapsedMs: round(quantile(elapsed, 0.5)),
    p90ElapsedMs: round(quantile(elapsed, 0.9)),
    maxElapsedMs: elapsed.length ? Math.max(...elapsed) : null,
    theoreticalDailyCapacity: average(requests) > 0 ? Math.floor(450 / average(requests)) : null,
    safeDailyCapacity: average(requests) > 0 ? Math.floor(420 / average(requests)) : null,
  };
}

function armSummary(records, arm) {
  const natural = records.filter((record) => record.kind === "natural");
  const direct = records.filter((record) => record.kind === "direct");
  const naturalExpected = natural.filter(hasExpected);
  const summary = {
    all: populationSummary(records),
    natural: populationSummary(natural),
    direct: populationSummary(direct),
    quotaNatural: quotaStats(natural),
    recallNaturalExpected: {
      candidate: recallStats(naturalExpected, "candidate_recall"),
      rawAgentSelection: arm === "D"
        ? { denominator: null, mean: null, anyHitRate: null }
        : recallStats(naturalExpected, "raw_agent_selection_recall"),
      final: recallStats(naturalExpected, "final_selection_recall"),
    },
    fallbackRateNatural: round(natural.length === 0 ? null : natural.filter((record) => record.fallback_used).length / natural.length),
    fallbackCountNatural: natural.filter((record) => record.fallback_used).length,
    stopReasonsNatural: stopReasons(natural),
    fallbackReasonsNatural: fallbackReasons(natural),
    rpmLimitRunsNatural: natural
      .filter((record) => stopReason(record) === "RPM_LIMIT_STOP")
      .map((record) => ({
        caseId: record.case_id,
        arm: record.arm,
        geminiRequests: metric(record, "gemini_requests"),
        candidateCount: Array.isArray(record.raw_agent_candidate_set) ? record.raw_agent_candidate_set.length : null,
        fallbackUsed: Boolean(record.fallback_used),
        fallbackReason: record.fallback_reason || [],
      })),
  };
  return summary;
}

function compareA6Ao(byArm) {
  const a6 = new Map(byArm.A6.filter((record) => record.kind === "natural" && hasExpected(record)).map((record) => [record.case_id, record]));
  const ao = new Map(byArm.AO.filter((record) => record.kind === "natural" && hasExpected(record)).map((record) => [record.case_id, record]));
  const ids = [...a6.keys()].filter((id) => ao.has(id));
  let aoOnly = 0;
  let a6Only = 0;
  let both = 0;
  let neither = 0;
  for (const id of ids) {
    const a6Hit = finalHit(a6.get(id));
    const aoHit = finalHit(ao.get(id));
    if (aoHit && !a6Hit) aoOnly += 1;
    else if (a6Hit && !aoHit) a6Only += 1;
    else if (a6Hit && aoHit) both += 1;
    else neither += 1;
  }
  const a6Quota = quotaStats([...a6.values()]);
  const aoQuota = quotaStats([...ao.values()]);
  const a6Recall = recallStats([...a6.values()], "final_selection_recall");
  const aoRecall = recallStats([...ao.values()], "final_selection_recall");
  const a6Candidate = recallStats([...a6.values()], "candidate_recall");
  const aoCandidate = recallStats([...ao.values()], "candidate_recall");
  const extraRequests = aoQuota.totalGeminiRequests - a6Quota.totalGeminiRequests;
  return {
    population: ids.length,
    finalHitComparison: { aoOnly, a6Only, both, neither },
    deltaAvgRequests: round(aoQuota.avgGeminiRequests - a6Quota.avgGeminiRequests),
    deltaFinalRecall: round(aoRecall.mean - a6Recall.mean),
    deltaCandidateRecall: round(aoCandidate.mean - a6Candidate.mean),
    extraGoldQuestions: aoOnly,
    extraRequestsTotal: extraRequests,
    extraRequestsPerAddedGoldQuestion: aoOnly > 0 ? round(extraRequests / aoOnly) : null,
  };
}

function eventInThreshold(event, threshold) {
  const index = finiteNumber(event.gemini_request_index);
  return threshold === ">12" ? index > 12 : index <= threshold;
}

function aoMarginal(byArm) {
  const records = byArm.AO.filter((record) => record.kind === "natural" && hasExpected(record));
  return thresholds.map((threshold) => {
    let newObservedCaseNumbers = 0;
    let goldFirstSeen = 0;
    let goldFinalSelectedQuestions = 0;
    for (const record of records) {
      const events = (record.agent_events || []).filter((event) => eventInThreshold(event, threshold));
      newObservedCaseNumbers += sum(events.map((event) => finiteNumber(event.new_case_number_count)));
      const expected = expectedNumbers(record);
      for (const gold of expected) {
        if (events.some((event) => (event.returned_case_numbers || []).some((value) => caseNumberMatches(value, gold)))) goldFirstSeen += 1;
      }
      const finalRequestCount = metric(record, "gemini_requests");
      const included = threshold === ">12" ? finalRequestCount > 12 : finalRequestCount <= threshold;
      if (included && finalHit(record)) goldFinalSelectedQuestions += 1;
    }
    return {
      threshold,
      newObservedCaseNumberCount: newObservedCaseNumbers,
      goldFirstSeenCount: goldFirstSeen,
      goldFinalSelectedQuestionCount: goldFinalSelectedQuestions,
      note: "M6C agent_events에는 provider ID가 없어 사건번호 관측 수를 provider 관측의 대리값으로 사용",
    };
  });
}

function tableRow(values) {
  return `| ${values.join(" | ")} |`;
}

function pct(value) {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function number(value) {
  return value === null ? "N/A" : String(value);
}

function buildReport(result) {
  const rows = [];
  rows.push("# Case Finder M6D Phase A 기준선 재집계 보고서");
  rows.push("");
  rows.push("## 상태");
  rows.push("");
  rows.push("`M6D_BASELINE_REANALYSIS_COMPLETE`");
  rows.push("");
  rows.push(`- 기준 SHA: \`${result.entrySha}\``);
  rows.push(`- 입력: 기존 M6C raw log 3개, 총 ${result.integrity.totalRecords}건`);
  rows.push(`- 무결성: ${result.integrity.valid ? "PASS" : "FAIL"} (고유 case-arm ${result.integrity.uniqueCaseArmKeys}건, 중복 ${result.integrity.duplicates.length}건)`);
  rows.push("- 외부 호출: 0회");
  rows.push("- 기존 M6C raw log와 M6C 최종 보고서는 수정하지 않음");
  rows.push("");
  rows.push("## 입력 무결성과 모집단");
  rows.push("");
  rows.push(tableRow(["항목", "값"]));
  rows.push(tableRow(["총 record", result.integrity.totalRecords]));
  rows.push(tableRow(["고유 (case_id, arm)", result.integrity.uniqueCaseArmKeys]));
  rows.push(tableRow(["D / A6 / AO", `${result.integrity.armCounts.D} / ${result.integrity.armCounts.A6} / ${result.integrity.armCounts.AO}`]));
  rows.push(tableRow(["duplicate", result.integrity.duplicates.length]));
  rows.push(tableRow(["ALL / NATURAL_ONLY / DIRECT_ONLY", `${result.populations.ALL} / ${result.populations.NATURAL_ONLY} / ${result.populations.DIRECT_ONLY}`]));
  rows.push(tableRow(["EMPTY_GOLD", result.populations.EMPTY_GOLD]));
  rows.push("");
  rows.push("## Table A — protocol과 validator 분리");
  rows.push("");
  rows.push("`verified output ≠ golden recall`이다. protocol PASS는 golden 기대값 포함 여부를 포함하며, verified 지표는 최종 출력 원소의 상태만 측정한다. D arm은 기존 raw log에 `final_product_output`이 없어 runner의 `verified_item_rate` proxy를 별도로 사용했다.");
  rows.push("");
  rows.push(tableRow(["arm", "population", "protocol PASS", "verified non-empty output", "verified item rate", "fallback rate (natural)"]));
  for (const arm of arms) {
    const s = result.byArm[arm];
    rows.push(tableRow([arm, `ALL ${s.all.records}`, `${s.all.protocolPass}/${s.all.records} (${pct(s.all.protocolPassRate)})`, `${s.all.verifiedNonemptyOutputRecords}/${s.all.nonemptyFinalRecords || 0} (${pct(s.all.verifiedNonemptyOutputRate)})`, `${pct(s.all.verifiedItemRate)} (${s.all.verifiedItemRateSource})`, pct(result.byArm[arm].fallbackRateNatural)]));
  }
  rows.push("");
  rows.push("## Table B — NATURAL_ONLY recall (expected gold가 있는 문항)");
  rows.push("");
  rows.push(tableRow(["arm", "denominator", "candidate mean / hit", "raw selection mean / hit", "final mean / hit"]));
  for (const arm of arms) {
    const r = result.byArm[arm].recallNaturalExpected;
    rows.push(tableRow([arm, r.final.denominator, `${number(r.candidate.mean)} / ${pct(r.candidate.anyHitRate)}`, `${number(r.rawAgentSelection.mean)} / ${pct(r.rawAgentSelection.anyHitRate)}`, `${number(r.final.mean)} / ${pct(r.final.anyHitRate)}`]));
  }
  rows.push("");
  rows.push("## Table C — NATURAL_ONLY quota와 latency");
  rows.push("");
  rows.push(tableRow(["arm", "total req", "avg", "median", "p90", "max", "retry", "MCP avg", "elapsed avg/median/p90 ms", "safe daily"]));
  for (const arm of arms) {
    const q = result.byArm[arm].quotaNatural;
    rows.push(tableRow([arm, q.totalGeminiRequests, q.avgGeminiRequests, q.medianGeminiRequests, q.p90GeminiRequests, q.maxGeminiRequests, `${q.totalRetryRequests} (${pct(q.retryRate)})`, q.avgMcpCalls, `${q.avgElapsedMs}/${q.medianElapsedMs}/${q.p90ElapsedMs}`, q.safeDailyCapacity]));
  }
  rows.push("");
  rows.push("## Table D — A6 → AO 한계효용");
  rows.push("");
  rows.push(tableRow(["지표", "값"]));
  rows.push(tableRow(["비교 모집단", result.a6Ao.population]));
  rows.push(tableRow(["AO만 final gold hit", result.a6Ao.finalHitComparison.aoOnly]));
  rows.push(tableRow(["A6만 final gold hit", result.a6Ao.finalHitComparison.a6Only]));
  rows.push(tableRow(["둘 다 성공 / 둘 다 실패", `${result.a6Ao.finalHitComparison.both} / ${result.a6Ao.finalHitComparison.neither}`]));
  rows.push(tableRow(["delta avg requests (AO-A6)", result.a6Ao.deltaAvgRequests]));
  rows.push(tableRow(["delta final recall", result.a6Ao.deltaFinalRecall]));
  rows.push(tableRow(["delta candidate recall", result.a6Ao.deltaCandidateRecall]));
  rows.push(tableRow(["extra requests total", result.a6Ao.extraRequestsTotal]));
  rows.push(tableRow(["extra requests / added gold question", number(result.a6Ao.extraRequestsPerAddedGoldQuestion)]));
  rows.push("");
  rows.push("## Table E — AO request-index 누적 관측");
  rows.push("");
  rows.push("기존 `agent_events`에 provider ID가 없으므로 `newObservedCaseNumberCount`를 provider 관측의 대리값으로 산출했다.");
  rows.push("");
  rows.push(tableRow(["누적 request", "new observed case numbers", "gold first-seen", "gold final-selected questions"]));
  for (const row of result.aoMarginal) rows.push(tableRow([row.threshold, row.newObservedCaseNumberCount, row.goldFirstSeenCount, row.goldFinalSelectedQuestionCount]));
  rows.push("");
  rows.push("## Table F — stop reason과 fallback");
  rows.push("");
  rows.push(tableRow(["arm", "stop reason (NATURAL_ONLY)", "fallback reason"]));
  for (const arm of ["A6", "AO"]) {
    const s = result.byArm[arm];
    rows.push(tableRow([arm, JSON.stringify(s.stopReasonsNatural), JSON.stringify(s.fallbackReasonsNatural)]));
  }
  rows.push("");
  rows.push("### RPM_LIMIT_STOP 별도 기록");
  rows.push("");
  const rpmRuns = arms.flatMap((arm) => result.byArm[arm].rpmLimitRunsNatural);
  rows.push(rpmRuns.length === 0 ? "- 해당 없음" : rpmRuns.map((run) => `- ${run.caseId} / ${run.arm} / Gemini ${run.geminiRequests}회 / 후보 ${run.candidateCount}건 / fallback=${run.fallbackUsed}`).join("\n"));
  rows.push("");
  rows.push("## 해석과 다음 checkpoint");
  rows.push("");
  rows.push("- 이 보고서는 기존 golden 30문항의 독립 재산출이며, 새로운 질문에 대한 일반화나 관련성의 블라인드 판정이 아니다.");
  rows.push("- 직접조회는 Route B이므로 retrieval recall primary population에 섞지 않았다.");
  rows.push("- validator 통과율과 golden 기대 판례 회수율은 별도 지표다.");
  rows.push("- 다음 단계는 M6D Phase B의 RPM fail→wait pacer 구현·테스트다. private holdout 질문 본문은 사용자 제공 전까지 생성·실행하지 않는다.");
  rows.push("");
  rows.push("## 산출물");
  rows.push("");
  rows.push("- `logs/m6d-baseline-reanalysis.json`");
  rows.push("- `docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md`");
  rows.push("- `test/m6d-reanalyze.js`");
  return `${rows.join("\n")}\n`;
}

async function readJsonLines(fileName) {
  const filePath = path.join(rootDir, "logs", fileName);
  const contents = await fs.readFile(filePath, "utf8");
  return contents.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return { ...JSON.parse(line), source: fileName, sourceLine: index + 1 };
    } catch (error) {
      fail(`${fileName}:${index + 1} JSON 파싱 실패: ${error.message}`);
    }
  });
}

const [golden, ...segments] = await Promise.all([
  fs.readFile(path.join(currentDir, "golden.json"), "utf8").then((value) => JSON.parse(value)),
  ...rawLogNames.map(readJsonLines),
]);
const records = segments.flat();
const goldenById = new Map(golden.cases.map((testCase) => [testCase.id, testCase]));
const seen = new Set();
const duplicates = [];
for (const record of records) {
  const key = `${record.case_id}\t${record.arm}`;
  if (seen.has(key)) duplicates.push(key);
  seen.add(key);
  const testCase = goldenById.get(record.case_id);
  if (!testCase) fail(`golden에 없는 case_id: ${record.case_id}`);
  if (record.kind !== testCase.kind) fail(`kind 불일치: ${record.case_id}`);
  if (record.arm && !arms.includes(record.arm)) fail(`알 수 없는 arm: ${record.arm}`);
}
const armCounts = Object.fromEntries(arms.map((arm) => [arm, records.filter((record) => record.arm === arm).length]));
const expectedKeys = new Set(golden.cases.flatMap((testCase) => arms.map((arm) => `${testCase.id}\t${arm}`)));
const missing = [...expectedKeys].filter((key) => !seen.has(key));
const unexpected = [...seen].filter((key) => !expectedKeys.has(key));
const integrity = {
  valid: records.length === 90 && seen.size === 90 && duplicates.length === 0 && missing.length === 0 && unexpected.length === 0 && arms.every((arm) => armCounts[arm] === 30),
  totalRecords: records.length,
  uniqueCaseArmKeys: seen.size,
  armCounts,
  duplicates,
  missing,
  unexpected,
  sources: Object.fromEntries(rawLogNames.map((name) => [name, records.filter((record) => record.source === name).length])),
};
if (!integrity.valid) fail(`M6D_BASELINE_INPUT_INVALID ${JSON.stringify(integrity)}`);

const byArm = Object.fromEntries(arms.map((arm) => [arm, records.filter((record) => record.arm === arm)]));
const populations = {
  ALL: records.length,
  NATURAL_ONLY: records.filter((record) => record.kind === "natural").length,
  DIRECT_ONLY: records.filter((record) => record.kind === "direct").length,
  EMPTY_GOLD: records.filter((record) => !hasExpected(record)).length,
};
const result = {
  recordType: "m6d_baseline_reanalysis",
  generatedAt: new Date().toISOString(),
  entrySha,
  suite: golden.version,
  rawLogs: rawLogNames,
  integrity,
  populations,
  byArm: Object.fromEntries(arms.map((arm) => [arm, armSummary(byArm[arm], arm)])),
  a6Ao: compareA6Ao(byArm),
  aoMarginal: aoMarginal(byArm),
};

await fs.writeFile(path.join(rootDir, "logs", "m6d-baseline-reanalysis.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
await fs.writeFile(path.join(rootDir, "docs", "CASE_FINDER_M6D_BASELINE_REANALYSIS.md"), buildReport(result), "utf8");
console.log(JSON.stringify({
  checkpoint: "M6D_BASELINE_REANALYSIS_COMPLETE",
  entrySha,
  integrity,
  populations,
  arms: Object.fromEntries(arms.map((arm) => [arm, {
    naturalRecall: result.byArm[arm].recallNaturalExpected.final,
    naturalQuota: result.byArm[arm].quotaNatural,
    protocolPass: result.byArm[arm].all.protocolPass,
    verifiedNonemptyOutputRate: result.byArm[arm].all.verifiedNonemptyOutputRate,
  }])),
  a6Ao: result.a6Ao,
  outputs: ["logs/m6d-baseline-reanalysis.json", "docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md"],
}, null, 2));
