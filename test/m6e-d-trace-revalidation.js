import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../config.js";
import { caseNumberKey } from "../src/router.js";

const rerunPath = path.resolve(ROOT_DIR, process.env.M6E_TRACE_RUN_LOG || "logs/m6e-d-trace-runs.jsonl");
const originalPath = path.resolve(ROOT_DIR, process.env.M6E_ORIGINAL_RUN_LOG || "logs/ph-private-holdout-runs.jsonl");
const comparisonPath = path.resolve(ROOT_DIR, process.env.M6E_COMPARISON || "logs/ph-private-holdout-arm-comparison.json");
const summaryPath = path.resolve(ROOT_DIR, process.env.M6E_TRACE_SUMMARY || "logs/m6e-d-trace-run-summary.json");
const outputPath = path.resolve(ROOT_DIR, process.env.M6E_TRACE_DIAGNOSIS || "logs/m6e-d-trace-diagnosis.json");

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonl(filePath) {
  return (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function finiteValues(rows, key) {
  return rows.map((row) => Number(row[key])).filter(Number.isFinite);
}

function stats(rows, key) {
  const values = finiteValues(rows, key).sort((left, right) => left - right);
  if (values.length === 0) return { mean: null, median: null, min: null, max: null };
  const middle = (values.length - 1) / 2;
  const lower = Math.floor(middle);
  const upper = Math.ceil(middle);
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: lower === upper ? values[lower] : (values[lower] + values[upper]) / 2,
    min: values[0],
    max: values[values.length - 1],
  };
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function groupFromWinner(winner) {
  if (winner === "A6") return "A6_RESCUEABLE";
  if (winner === "AO") return "AO_ONLY_LOSS";
  if (winner === "tie") return "TIE";
  return "D_WIN";
}

function setFromSelected(items) {
  return new Set((items || []).map((item) => caseNumberKey(item.caseNumber)).filter(Boolean));
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...new Set([...left, ...right])].filter((key) => left.has(key) && right.has(key)).length / union.size;
}

function signalRows(record, group, original) {
  const trace = record.d_trace;
  const raw = trace.raw_selection || {};
  const candidates = trace.candidates || {};
  const dispersion = trace.search_dispersion || {};
  const ranking = candidates.ranking || {};
  const originalSelected = setFromSelected(original?.final_product_output?.selected);
  const rerunSelected = setFromSelected(record.final_product_output?.selected);
  return {
    question_id: record.question_id,
    group,
    raw_selection_empty: Boolean(raw.raw_selection_empty),
    raw_selected_count: Number(raw.raw_selected_count || 0),
    raw_direct_count: Number(raw.raw_direct_count || 0),
    raw_direct_ratio: raw.raw_direct_ratio,
    raw_selected_matched_keywords_mean: raw.raw_selected_matched_keywords?.mean,
    raw_selected_matched_keywords_min: raw.raw_selected_matched_keywords?.min,
    raw_selected_matched_keywords_max: raw.raw_selected_matched_keywords?.max,
    raw_selected_preview_missing_ratio: raw.raw_selected_count > 0 ? raw.raw_selected_preview_missing_count / raw.raw_selected_count : null,
    raw_candidate_count: Number(candidates.raw_candidate_count || 0),
    initial_ranked_candidate_count: Number(candidates.initial_ranked_candidate_count || 0),
    preview_candidate_count: Number(candidates.preview_candidate_count || 0),
    final_ranked_candidate_count: Number(candidates.final_ranked_candidate_count || 0),
    top5_matched_keywords_mean: candidates.top5_summary?.matched_keywords?.mean,
    top5_matched_keywords_min: candidates.top5_summary?.matched_keywords?.min,
    top5_matched_keywords_max: candidates.top5_summary?.matched_keywords?.max,
    single_query_candidate_ratio: candidates.single_query_candidate_ratio,
    multi_query_candidate_ratio: candidates.multi_query_candidate_ratio,
    rank1_rank2_margin: ranking.rank1_rank2_margin,
    rank1_rank3_margin: ranking.rank1_rank3_margin,
    rank1_rank2_margin_ratio: ranking.rank1_rank2_margin_ratio,
    top5_score_stddev: ranking.top5_score_stddev,
    top5_preview_missing_ratio: candidates.top5_preview_missing_ratio,
    zero_result_query_ratio: trace.search_queries.length === 0 ? null : dispersion.zero_result_query_count / trace.search_queries.length,
    unique_candidate_yield_mean: dispersion.unique_candidate_yield?.mean,
    candidate_yield_stddev: dispersion.candidate_yield_stddev,
    plan_keyword_count: trace.plan?.keyword_count,
    plan_domain_count: trace.plan?.domain_count,
    plan_law_name_count: trace.plan?.law_name_count,
    selected_verified_count: trace.final_selection?.selected_verified_count,
    selected_validation_failed_count: trace.final_selection?.selected_validation_failed_count,
    original_selected_count: originalSelected.size,
    new_selected_count: rerunSelected.size,
    selected_set_jaccard: jaccard(originalSelected, rerunSelected),
    direct_count_original: (original?.final_product_output?.selected || []).filter((item) => item.match === "direct").length,
    direct_count_new: (record.final_product_output?.selected || []).filter((item) => item.match === "direct").length,
    gemini_requests: Number(record.gemini_requests || 0),
    mcp_calls_total: Number(record.mcp_calls_total || 0),
    rpm_wait_ms: Number(record.gemini_rpm_wait_ms || 0),
    elapsed_ms: Number(record.elapsed_ms || 0),
  };
}

const [reruns, originals, comparison, runSummary] = await Promise.all([
  readJsonl(rerunPath),
  readJsonl(originalPath),
  readJson(comparisonPath),
  readJson(summaryPath),
]);
const winnerByQuestion = Object.fromEntries(comparison.question_comparison.map((row) => [row.question_id, groupFromWinner(row.winner)]));
const originalByQuestion = Object.fromEntries(originals.filter((record) => record.arm === "D").map((record) => [record.question_id, record]));
const rows = reruns.map((record) => signalRows(record, winnerByQuestion[record.question_id], originalByQuestion[record.question_id]));

const signalKeys = [
  "raw_selected_count", "raw_direct_count", "raw_direct_ratio", "raw_selected_matched_keywords_mean",
  "raw_selected_preview_missing_ratio", "raw_candidate_count", "top5_matched_keywords_mean",
  "single_query_candidate_ratio", "multi_query_candidate_ratio", "rank1_rank2_margin", "rank1_rank3_margin",
  "rank1_rank2_margin_ratio", "top5_score_stddev", "top5_preview_missing_ratio", "zero_result_query_ratio",
  "unique_candidate_yield_mean", "candidate_yield_stddev", "plan_keyword_count", "plan_domain_count",
  "plan_law_name_count", "selected_set_jaccard", "direct_count_original", "direct_count_new",
];
const groupSummary = Object.fromEntries(["D_WIN", "A6_RESCUEABLE", "AO_ONLY_LOSS", "TIE"].map((group) => {
  const groupRows = rows.filter((row) => row.group === group);
  return [group, {
    count: groupRows.length,
    signals: Object.fromEntries(signalKeys.map((key) => [key, stats(groupRows, key)])),
  }];
}));

const separation = signalKeys.map((key) => {
  const d = stats(rows.filter((row) => row.group === "D_WIN"), key);
  const rescue = stats(rows.filter((row) => row.group === "A6_RESCUEABLE"), key);
  return {
    signal: key,
    d_win_mean: d.mean,
    rescue_mean: rescue.mean,
    absolute_mean_delta: d.mean === null || rescue.mean === null ? null : Math.abs(d.mean - rescue.mean),
  };
}).filter((row) => row.absolute_mean_delta !== null).sort((left, right) => right.absolute_mean_delta - left.absolute_mean_delta);

const gates = [
  { name: "raw_selection_empty == true", condition: (row) => row.raw_selection_empty },
  { name: "raw_selected_count <= 1", condition: (row) => row.raw_selected_count <= 1 },
  { name: "rank1_rank2_margin <= 5", condition: (row) => Number.isFinite(row.rank1_rank2_margin) && row.rank1_rank2_margin <= 5 },
];
const gateMetrics = gates.map(({ name, condition }) => {
  const triggered = rows.filter(condition);
  const tp = triggered.filter((row) => row.group === "A6_RESCUEABLE").length;
  const dFalse = triggered.filter((row) => row.group === "D_WIN").length;
  const nonbeneficial = triggered.length - tp;
  return {
    condition: name,
    trigger_count: triggered.length,
    trigger_ids: triggered.map((row) => row.question_id),
    tp,
    fn: 8 - tp,
    rescue_recall: tp / 8,
    rescue_precision: triggered.length === 0 ? null : tp / triggered.length,
    d_win_false_trigger: dFalse,
    d_win_preservation_specificity: 1 - (dFalse / 15),
    tie_trigger: triggered.filter((row) => row.group === "TIE").length,
    ao_only_loss_trigger: triggered.filter((row) => row.group === "AO_ONLY_LOSS").length,
    nonbeneficial_trigger_rate: triggered.length === 0 ? null : nonbeneficial / triggered.length,
  };
});

const protocol = {
  run_count: reruns.length,
  pass_count: reruns.filter((record) => record.status === "PASS").length,
  fail_count: reruns.filter((record) => record.status !== "PASS").length,
  rpm_hard_stop_count: reruns.filter((record) => record.agent_stop_reason === "RPM_LIMIT_STOP").length,
  rpd_hard_stop_count: reruns.filter((record) => ["RPD_LIMIT_STOP", "RPD_RESERVE_STOP"].includes(record.agent_stop_reason)).length,
  all_trace_present: reruns.every((record) => record.d_trace?.schema_version === "m6e-d-trace-v1"),
  all_validator_pass: reruns.every((record) => record.d_trace?.validator?.protocol_pass === true),
};
const stochasticity = {
  mean_selected_set_jaccard: stats(rows, "selected_set_jaccard").mean,
  median_selected_set_jaccard: stats(rows, "selected_set_jaccard").median,
  changed_selection_count: rows.filter((row) => row.selected_set_jaccard < 1).length,
  direct_count_changed_count: rows.filter((row) => row.direct_count_original !== row.direct_count_new).length,
  original_vs_rerun: rows.map((row) => ({
    question_id: row.question_id,
    selected_set_jaccard: row.selected_set_jaccard,
    direct_count_original: row.direct_count_original,
    direct_count_new: row.direct_count_new,
  })),
};
const diagnosis = {
  checkpoint: "M6E_D_TRACE_REVALIDATION_COMPLETE",
  next_checkpoint: "M6E_USER_REVIEW_REQUIRED",
  recommendation: "B3_DA6_GATE_NOT_JUSTIFIED",
  instrumentation_parity: {
    checkpoint: "M6E_D_TRACE_INSTRUMENTATION_PARITY_PASS",
    test: "test/m6e-d-trace-parity.js",
    behavior_changed: false,
    fields_collected: ["plan", "search_queries", "search_dispersion", "candidates", "raw_selection", "final_selection", "validator"],
    private_query_text_tracked: false,
  },
  live_run: {
    arm: "D",
    question_count: 30,
    new_gemini_requests: reruns.reduce((sum, record) => sum + Number(record.gemini_requests || 0), 0),
    mcp_calls: reruns.reduce((sum, record) => sum + Number(record.mcp_calls_total || 0), 0),
    rpm_wait_events: reruns.reduce((sum, record) => sum + Number(record.gemini_rpm_wait_events || 0), 0),
    rpm_wait_ms: reruns.reduce((sum, record) => sum + Number(record.gemini_rpm_wait_ms || 0), 0),
    protocol,
    quota: runSummary.quota,
  },
  d_stochasticity: stochasticity,
  group_summary: groupSummary,
  top_five_signal_mean_separation: separation.slice(0, 5),
  gate_candidates: gateMetrics,
  limitations: [
    "표본은 PH 30문항이며 A6_RESCUEABLE은 8문항, AO_ONLY_LOSS는 2문항이다.",
    "PH comparator label은 기존 blind review 결과로 freeze했으며 새 D-run으로 변경하지 않았다.",
    "새 D-run과 기존 D-run의 모델/검색 변동이 있어 gate signal과 D stochasticity를 분리해 해석해야 한다.",
    "gate 후보는 PH retrospective 분석이므로 새 private holdout에서 재검증되기 전 제품 gate로 사용할 수 없다.",
    "search API의 reported total은 MCP text parser에 보존되지 않아 exposed result count 중심으로 기록했다.",
  ],
  sources: {
    rerun_log: path.relative(ROOT_DIR, rerunPath),
    original_log: path.relative(ROOT_DIR, originalPath),
    comparison: path.relative(ROOT_DIR, comparisonPath),
  },
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  checkpoint: diagnosis.checkpoint,
  recommendation: diagnosis.recommendation,
  protocol,
  stochasticity: {
    mean_selected_set_jaccard: stochasticity.mean_selected_set_jaccard,
    changed_selection_count: stochasticity.changed_selection_count,
    direct_count_changed_count: stochasticity.direct_count_changed_count,
  },
  top_five_signal_mean_separation: diagnosis.top_five_signal_mean_separation,
  gate_candidates: gateMetrics,
  output: outputPath,
}, null, 2));
