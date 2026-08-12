import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../config.js";

const runLogPath = path.resolve(ROOT_DIR, process.env.M6E_RUN_LOG || "logs/ph-private-holdout-runs.jsonl");
const comparisonPath = path.resolve(ROOT_DIR, process.env.M6E_COMPARISON || "logs/ph-private-holdout-arm-comparison.json");
const outputPath = path.resolve(ROOT_DIR, process.env.M6E_DIAGNOSIS_OUTPUT || "logs/m6e-d-loss-diagnosis.json");

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

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = (sorted.length - 1) / 2;
  const lower = Math.floor(middle);
  const upper = Math.ceil(middle);
  return lower === upper ? sorted[lower] : (sorted[lower] + sorted[upper]) / 2;
}

function summary(rows, key) {
  const values = rows.map((row) => row[key]).filter(Number.isFinite);
  return {
    mean: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    median: median(values),
    min: values.length === 0 ? null : Math.min(...values),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

function groupSummary(rows) {
  const keys = ["selected_count", "direct_count", "related_count", "direct_ratio", "verified_count", "mcp_search_calls", "mcp_detail_calls", "mcp_calls_total", "gemini_requests", "elapsed_ms"];
  return Object.fromEntries(["D_WIN", "A6_RESCUEABLE", "AO_ONLY_LOSS", "TIE"].map((group) => {
    const groupRows = rows.filter((row) => row.group === group);
    return [group, {
      count: groupRows.length,
      metrics: Object.fromEntries(keys.map((key) => [key, summary(groupRows, key)])),
    }];
  }));
}

function gateStats(rows, name, predicate) {
  const triggered = rows.filter(predicate);
  const rescued = triggered.filter((row) => row.group === "A6_RESCUEABLE").length;
  return {
    name,
    trigger_count: triggered.length,
    trigger_ids: triggered.map((row) => row.question_id),
    rescue_recall: rescued / 8,
    rescue_precision: triggered.length === 0 ? null : rescued / triggered.length,
    false_rescue_count: triggered.filter((row) => row.group === "D_WIN").length,
    tie_trigger_count: triggered.filter((row) => row.group === "TIE").length,
    ao_only_loss_trigger_count: triggered.filter((row) => row.group === "AO_ONLY_LOSS").length,
  };
}

const [runs, comparison] = await Promise.all([readJsonl(runLogPath), readJson(comparisonPath)]);
const winnerByQuestion = Object.fromEntries(comparison.question_comparison.map((row) => [
  row.question_id,
  row.winner === "A6" ? "A6_RESCUEABLE" : row.winner === "AO" ? "AO_ONLY_LOSS" : row.winner === "tie" ? "TIE" : "D_WIN",
]));
const dRows = runs.filter((record) => record.arm === "D").map((record) => {
  const selected = Array.isArray(record.final_product_output?.selected) ? record.final_product_output.selected : [];
  const directCount = selected.filter((item) => item.match === "direct").length;
  const relatedCount = selected.filter((item) => item.match === "related").length;
  return {
    question_id: record.question_id,
    group: winnerByQuestion[record.question_id],
    selected_count: selected.length,
    direct_count: directCount,
    related_count: relatedCount,
    direct_ratio: selected.length === 0 ? null : directCount / selected.length,
    selection_empty_before_ranked_fill: null,
    verified_count: Array.isArray(record.final_verified_items) ? record.final_verified_items.length : 0,
    fallback_used: Boolean(record.fallback_used),
    mcp_search_calls: Number(record.mcp_search_calls || 0),
    mcp_detail_calls: Number(record.mcp_detail_calls || 0),
    mcp_calls_total: Number(record.mcp_calls_total || 0),
    gemini_requests: Number(record.gemini_requests || 0),
    elapsed_ms: Number(record.elapsed_ms || 0),
    raw_candidate_count: null,
    ranked_candidate_count: null,
    preview_candidate_count: null,
    selected_preview_present_count: null,
    selected_preview_missing_count: null,
    ranking_scores: null,
    search_plan: null,
  };
});

const gates = [
  gateStats(dRows, "selected_count <= 1", (row) => row.selected_count <= 1),
  gateStats(dRows, "direct_count == 0", (row) => row.direct_count === 0),
  gateStats(dRows, "selected_count <= 1 AND direct_count == 0", (row) => row.selected_count <= 1 && row.direct_count === 0),
];
const diagnosis = {
  checkpoint: "M6E_D_LOSS_DIAGNOSIS_COMPLETE",
  next_checkpoint: "M6E_USER_REVIEW_REQUIRED",
  evidence: {
    source_run_log: path.relative(ROOT_DIR, runLogPath),
    source_comparison: path.relative(ROOT_DIR, comparisonPath),
    new_gemini_calls: 0,
    d_run_count: dRows.length,
    groups: {
      D_WIN: dRows.filter((row) => row.group === "D_WIN").map((row) => row.question_id),
      A6_RESCUEABLE: dRows.filter((row) => row.group === "A6_RESCUEABLE").map((row) => row.question_id),
      AO_ONLY_LOSS: dRows.filter((row) => row.group === "AO_ONLY_LOSS").map((row) => row.question_id),
      TIE: dRows.filter((row) => row.group === "TIE").map((row) => row.question_id),
    },
  },
  data_availability: {
    available: ["final_product_output.selected", "final_verified_items count", "fallback_used", "Gemini request count", "MCP search/detail/total counts", "elapsed_ms"],
    unavailable: ["D raw selection before ranked fill", "D raw candidate list", "ranked candidate list and scores", "matchedKeywords", "preview availability", "D Gemini plan keywords/domains/law names", "per-query result dispersion"],
    interpretation: "The holdout runner did not persist D-internal candidate/ranking/plan trace. Empty raw_agent_candidate_set in D records is not evidence of zero candidates; it is an unrecorded field.",
  },
  question_signals: dRows,
  group_summary: groupSummary(dRows),
  gate_candidates: gates,
  recommendation: {
    deterministic_gate_sufficient: false,
    evidence_state_needed: false,
    reason: "Only post-ranked output proxies are available, and the candidate/ranking/plan signals required by the handoff are absent. No product gate should be approved from this retrospective proxy-only evidence.",
  },
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(diagnosis, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  checkpoint: diagnosis.checkpoint,
  next_checkpoint: diagnosis.next_checkpoint,
  d_run_count: dRows.length,
  gate_candidates: gates,
  data_unavailable_count: diagnosis.data_availability.unavailable.length,
  output: outputPath,
}, null, 2));
