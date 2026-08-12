import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR } from "../config.js";

const privateDir = path.resolve(ROOT_DIR, process.env.REVIEW_PRIVATE_DIR || path.join("test", "private", "m6d-holdout"));
const packetPath = path.join(privateDir, process.env.REVIEW_PACKET_FILE || "blind_packet.json");
const keyPath = path.join(privateDir, process.env.REVIEW_KEY_FILE || "unmask_key.json");
const scoresPath = path.join(privateDir, process.env.REVIEW_SCORES_FILE || "blind_review_scores.jsonl");
const runLogPath = path.resolve(ROOT_DIR, process.env.REVIEW_RUN_LOG || path.join("logs", "m6d-private-holdout-runs.jsonl"));
const runSummaryPath = path.resolve(ROOT_DIR, process.env.REVIEW_RUN_SUMMARY || path.join("logs", "m6d-private-holdout-run-summary.json"));
const validationPath = path.resolve(ROOT_DIR, process.env.REVIEW_VALIDATION || path.join("logs", "m6d-private-holdout-review-validation.json"));
const comparisonPath = path.resolve(ROOT_DIR, process.env.REVIEW_COMPARISON || path.join("logs", "m6d-private-holdout-arm-comparison.json"));
const reviewPrefix = process.env.REVIEW_PREFIX || "M6D";
const reviewValidCheckpoint = process.env.REVIEW_VALID_CHECKPOINT || `${reviewPrefix}_REVIEW_SCHEMA_VALID`;
const reviewInvalidCheckpoint = process.env.REVIEW_INVALID_CHECKPOINT || `${reviewPrefix}_REVIEW_SCHEMA_INVALID`;
const comparisonCheckpoint = process.env.REVIEW_COMPARISON_CHECKPOINT || `${reviewPrefix}_BLIND_REVIEW_VALIDATED`;
const arms = ["D", "A6", "AO"];
const relevanceTier = {
  IRRELEVANT: 0,
  UNRESOLVED: 1,
  WEAK_SUPPORT: 2,
  STRONG_SUPPORT: 3,
  DIRECT: 4,
};
const relevantLabels = new Set(["DIRECT", "STRONG_SUPPORT", "WEAK_SUPPORT"]);
const usableLabels = new Set(["DIRECT", "STRONG_SUPPORT"]);
const relevanceLabels = new Set(Object.keys(relevanceTier));
const flagLabels = new Set(["YES", "NO", "UNRESOLVED"]);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function readJsonl(filePath) {
  return (await fs.readFile(filePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${reviewPrefix}_REVIEW_JSONL_INVALID line=${index + 1}: ${error.message}`);
      }
    });
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length === 0 ? null : valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compareNumbers(left, right) {
  const a = Number.isFinite(left) ? left : -1;
  const b = Number.isFinite(right) ? right : -1;
  return a === b ? 0 : a > b ? 1 : -1;
}

function compareQuestionQuality(left, right) {
  const comparisons = [
    compareNumbers(left.best_relevance_tier, right.best_relevance_tier),
    compareNumbers(left.relative_axis_coverage, right.relative_axis_coverage),
    compareNumbers(left.usable_count, right.usable_count),
    compareNumbers(left.broad_usable_count, right.broad_usable_count),
    compareNumbers(right.irrelevant_count, left.irrelevant_count),
    compareNumbers(right.gemini_requests, left.gemini_requests),
  ];
  return comparisons.find((value) => value !== 0) || 0;
}

function validateAndIndex({ packet, key, scores }) {
  const issues = [];
  const packetSamples = Array.isArray(packet.samples) ? packet.samples : [];
  const keySamples = Array.isArray(key.samples) ? key.samples : [];
  if (packet.schema_version !== "m6d-blind-packet-v1") issues.push("packet_schema_version");
  if (key.schema_version !== "m6d-unmask-key-v1") issues.push("key_schema_version");
  if (packet.packet_id !== key.packet_id) issues.push("packet_id_mismatch");

  const packetById = new Map();
  for (const sample of packetSamples) {
    if (!exactKeys(sample, ["sample_id", "question_id", "question_text", "provider_id", "source_locator"])) issues.push(`packet_keys:${sample.sample_id}`);
    if (packetById.has(sample.sample_id)) issues.push(`packet_duplicate:${sample.sample_id}`);
    packetById.set(sample.sample_id, sample);
  }
  const keyById = new Map();
  for (const sample of keySamples) {
    if (!exactKeys(sample, ["sample_id", "question_id", "provider_id", "arms", "rank_by_arm"])) issues.push(`key_keys:${sample.sample_id}`);
    if (keyById.has(sample.sample_id)) issues.push(`key_duplicate:${sample.sample_id}`);
    if (!Array.isArray(sample.arms) || sample.arms.length === 0 || sample.arms.some((arm) => !arms.includes(arm))) issues.push(`key_arms:${sample.sample_id}`);
    if (!sample.rank_by_arm || Object.keys(sample.rank_by_arm).some((arm) => !arms.includes(arm))) issues.push(`key_rank_arms:${sample.sample_id}`);
    keyById.set(sample.sample_id, sample);
  }
  const scoreById = new Map();
  for (const score of scores) {
    if (!exactKeys(score, ["sample_id", "question_id", "provider_id", "relevance", "issue_axes", "quote_support", "limitation_needed"])) issues.push(`score_keys:${score.sample_id}`);
    if (scoreById.has(score.sample_id)) issues.push(`score_duplicate:${score.sample_id}`);
    if (!relevanceLabels.has(score.relevance)) issues.push(`score_relevance:${score.sample_id}`);
    if (!Array.isArray(score.issue_axes) || score.issue_axes.some((axis) => typeof axis !== "string")) issues.push(`score_issue_axes:${score.sample_id}`);
    if (!flagLabels.has(score.quote_support)) issues.push(`score_quote_support:${score.sample_id}`);
    if (!flagLabels.has(score.limitation_needed)) issues.push(`score_limitation_needed:${score.sample_id}`);
    scoreById.set(score.sample_id, score);
  }
  const packetIds = new Set(packetById.keys());
  const keyIds = new Set(keyById.keys());
  const scoreIds = new Set(scoreById.keys());
  for (const id of unique([...packetIds, ...keyIds, ...scoreIds])) {
    if (!packetIds.has(id)) issues.push(`unknown_packet_sample:${id}`);
    if (!keyIds.has(id)) issues.push(`missing_key_sample:${id}`);
    if (!scoreIds.has(id)) issues.push(`missing_score:${id}`);
    const packetSample = packetById.get(id);
    const keySample = keyById.get(id);
    const score = scoreById.get(id);
    if (packetSample && keySample && (packetSample.question_id !== keySample.question_id || packetSample.provider_id !== keySample.provider_id)) issues.push(`key_provider_mismatch:${id}`);
    if (packetSample && score && (packetSample.question_id !== score.question_id || packetSample.provider_id !== score.provider_id)) issues.push(`score_provider_mismatch:${id}`);
  }
  return { issues, packetById, keyById, scoreById };
}

function buildQuestionArmMetrics(questionId, arm, keySamples, scoreById, runByQuestionArm) {
  const samples = keySamples.filter((sample) => sample.question_id === questionId && sample.arms.includes(arm));
  const reviews = samples.map((sample) => scoreById.get(sample.sample_id));
  const axisSet = new Set();
  for (const review of reviews) {
    if (relevantLabels.has(review.relevance)) for (const axis of review.issue_axes) axisSet.add(axis);
  }
  const run = runByQuestionArm.get(`${questionId}|${arm}`);
  const questionPoolAxes = run?.questionPoolAxes || new Set();
  return {
    question_id: questionId,
    arm,
    sample_count: reviews.length,
    best_relevance_tier: reviews.length === 0 ? 0 : Math.max(...reviews.map((review) => relevanceTier[review.relevance])),
    best_relevance: reviews.length === 0 ? "NONE" : reviews.reduce((best, review) => relevanceTier[review.relevance] > relevanceTier[best] ? review.relevance : best, "IRRELEVANT"),
    direct_count: reviews.filter((review) => review.relevance === "DIRECT").length,
    strong_support_count: reviews.filter((review) => review.relevance === "STRONG_SUPPORT").length,
    weak_support_count: reviews.filter((review) => review.relevance === "WEAK_SUPPORT").length,
    usable_count: reviews.filter((review) => usableLabels.has(review.relevance)).length,
    broad_usable_count: reviews.filter((review) => relevantLabels.has(review.relevance)).length,
    irrelevant_count: reviews.filter((review) => review.relevance === "IRRELEVANT").length,
    unresolved_count: reviews.filter((review) => review.relevance === "UNRESOLVED").length,
    issue_axis_count: axisSet.size,
    relative_axis_coverage: questionPoolAxes.size === 0 ? null : round(axisSet.size / questionPoolAxes.size),
    gemini_requests: Number(run?.gemini_requests || 0),
    rpm_wait_ms: Number(run?.gemini_rpm_wait_ms || 0),
    sample_ids: samples.map((sample) => sample.sample_id),
  };
}

function buildComparison(packet, key, scores, runs, runSummary) {
  const questionIds = unique(packet.samples.map((sample) => sample.question_id)).sort();
  const keySamples = key.samples;
  const scoreById = new Map(scores.map((score) => [score.sample_id, score]));
  const runByQuestionArm = new Map();
  for (const run of runs) runByQuestionArm.set(`${run.question_id}|${run.arm}`, run);
  for (const questionId of questionIds) {
    const poolAxes = new Set();
    for (const sample of keySamples.filter((item) => item.question_id === questionId)) {
      const review = scoreById.get(sample.sample_id);
      if (relevantLabels.has(review.relevance)) for (const axis of review.issue_axes) poolAxes.add(axis);
    }
    for (const arm of arms) {
      const run = runByQuestionArm.get(`${questionId}|${arm}`);
      if (run) run.questionPoolAxes = poolAxes;
    }
  }
  const questionRows = questionIds.map((questionId) => {
    const metrics = Object.fromEntries(arms.map((arm) => [arm, buildQuestionArmMetrics(questionId, arm, keySamples, scoreById, runByQuestionArm)]));
    const ordered = [...arms].sort((left, right) => compareQuestionQuality(metrics[right], metrics[left]));
    const top = ordered[0];
    const second = ordered[1];
    const winner = compareQuestionQuality(metrics[top], metrics[second]) === 0 ? "tie" : top;
    return { question_id: questionId, winner, arms: metrics };
  });
  const armQuality = {};
  for (const arm of arms) {
    const rows = questionRows.map((row) => row.arms[arm]);
    const reviewedSamples = rows.reduce((sum, row) => sum + row.sample_count, 0);
    armQuality[arm] = {
      question_wins: questionRows.filter((row) => row.winner === arm).length,
      direct_hit_questions: rows.filter((row) => row.direct_count > 0).length,
      strong_support_hit_questions: rows.filter((row) => row.strong_support_count > 0).length,
      usable_selected_count: rows.reduce((sum, row) => sum + row.usable_count, 0),
      broad_usable_selected_count: rows.reduce((sum, row) => sum + row.broad_usable_count, 0),
      direct_sample_count: rows.reduce((sum, row) => sum + row.direct_count, 0),
      strong_support_sample_count: rows.reduce((sum, row) => sum + row.strong_support_count, 0),
      irrelevant_count: rows.reduce((sum, row) => sum + row.irrelevant_count, 0),
      unresolved_count: rows.reduce((sum, row) => sum + row.unresolved_count, 0),
      reviewed_sample_count: reviewedSamples,
      irrelevant_rate: reviewedSamples === 0 ? null : round(rows.reduce((sum, row) => sum + row.irrelevant_count, 0) / reviewedSamples),
      mean_relative_axis_coverage: round(average(rows.map((row) => row.relative_axis_coverage))),
      quota: runSummary.arm_summary[arm],
    };
  }
  const a6Rows = Object.fromEntries(questionRows.map((row) => [row.question_id, row.arms.A6]));
  const aoRows = Object.fromEntries(questionRows.map((row) => [row.question_id, row.arms.AO]));
  const extraRequestsTotal = questionRows.reduce((sum, row) => sum + (row.arms.AO.gemini_requests - row.arms.A6.gemini_requests), 0);
  const aoOnlyDirectQuestions = questionRows.filter((row) => row.arms.AO.direct_count > 0 && row.arms.A6.direct_count === 0).length;
  const aoOnlyUsableSamples = questionRows.reduce((sum, row) => {
    const a6Ids = new Set(row.arms.A6.sample_ids.filter((id) => usableLabels.has(scoreById.get(id).relevance)));
    const aoIds = row.arms.AO.sample_ids.filter((id) => usableLabels.has(scoreById.get(id).relevance));
    return sum + aoIds.filter((id) => !a6Ids.has(id)).length;
  }, 0);
  const a6Coverage = average(questionRows.map((row) => row.arms.A6.relative_axis_coverage));
  const aoCoverage = average(questionRows.map((row) => row.arms.AO.relative_axis_coverage));
  const a6DirectQuestions = armQuality.A6.direct_hit_questions;
  const aoDirectQuestions = armQuality.AO.direct_hit_questions;
  const deltaDirect = aoDirectQuestions - a6DirectQuestions;
  const deltaUsable = armQuality.AO.usable_selected_count - armQuality.A6.usable_selected_count;
  return {
    checkpoint: comparisonCheckpoint,
    packet_id: packet.packet_id,
    validation: {
      score_count: scores.length,
      sample_count: packet.samples.length,
      unmask_count: key.samples.length,
      reviewer_labels_used_as_is: true,
    },
    question_comparison: questionRows,
    arm_quality: armQuality,
    a6_to_ao_marginal_utility: {
      additional_requests: round(average(questionRows.map((row) => row.arms.AO.gemini_requests)) - average(questionRows.map((row) => row.arms.A6.gemini_requests))),
      total_extra_requests: extraRequestsTotal,
      delta_direct_hit_questions: deltaDirect,
      added_direct_hit_questions: aoOnlyDirectQuestions,
      delta_usable_selected_count: deltaUsable,
      ao_only_usable_samples: aoOnlyUsableSamples,
      delta_mean_relative_axis_coverage: round((aoCoverage ?? 0) - (a6Coverage ?? 0)),
      extra_requests_per_added_direct_question: extraRequestsTotal > 0 && aoOnlyDirectQuestions > 0
        ? round(extraRequestsTotal / aoOnlyDirectQuestions)
        : null,
      extra_requests_per_added_usable_sample: extraRequestsTotal > 0 && aoOnlyUsableSamples > 0
        ? round(extraRequestsTotal / aoOnlyUsableSamples)
        : null,
    },
  };
}

async function main() {
  const [packet, key, scores, runs, runSummary] = await Promise.all([
    readJson(packetPath),
    readJson(keyPath),
    readJsonl(scoresPath),
    readJsonl(runLogPath),
    readJson(runSummaryPath),
  ]);
  const indexed = validateAndIndex({ packet, key, scores });
  const validation = {
    checkpoint: indexed.issues.length === 0 ? reviewValidCheckpoint : reviewInvalidCheckpoint,
    packet_id: packet.packet_id,
    score_count: scores.length,
    sample_count: packet.samples?.length || 0,
    unmask_count: key.samples?.length || 0,
    issues: indexed.issues,
    checks: {
      missing: indexed.issues.filter((issue) => issue.startsWith("missing_")).length,
      duplicates: indexed.issues.filter((issue) => issue.includes("duplicate")).length,
      unknown: indexed.issues.filter((issue) => issue.startsWith("unknown_")).length,
      enum_or_shape: indexed.issues.filter((issue) => issue.startsWith("score_") || issue.startsWith("packet_keys") || issue.startsWith("key_")).length,
      provider_mismatch: indexed.issues.filter((issue) => issue.includes("provider_mismatch")).length,
    },
  };
  await fs.writeFile(validationPath, `${JSON.stringify(validation, null, 2)}\n`, "utf8");
  if (indexed.issues.length > 0) {
    console.error(JSON.stringify(validation, null, 2));
    process.exitCode = 1;
    return;
  }
  const comparison = buildComparison(packet, key, scores, runs, runSummary);
  await fs.writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    checkpoint: comparison.checkpoint,
    validation: validation.checks,
    question_wins: Object.fromEntries(arms.map((arm) => [arm, comparison.arm_quality[arm].question_wins])),
    direct_hit_questions: Object.fromEntries(arms.map((arm) => [arm, comparison.arm_quality[arm].direct_hit_questions])),
    usable_selected_count: Object.fromEntries(arms.map((arm) => [arm, comparison.arm_quality[arm].usable_selected_count])),
    relative_axis_coverage: Object.fromEntries(arms.map((arm) => [arm, comparison.arm_quality[arm].mean_relative_axis_coverage])),
    irrelevant_rate: Object.fromEntries(arms.map((arm) => [arm, comparison.arm_quality[arm].irrelevant_rate])),
    a6_to_ao: comparison.a6_to_ao_marginal_utility,
    output: comparisonPath,
  }, null, 2));
}

await main();
