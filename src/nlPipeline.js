import crypto from "node:crypto";
import { config } from "../config.js";
import { generatePlan, runtimeName, selectCandidates } from "./geminiRuntime.js";
import {
  lookupDecisionCandidate,
  enrichLawReferences,
  lawDetailLink,
  parseDecisionDetail,
  parseLawSearchResults,
  parseStatuteReferences,
  parseDecisionSearchResults,
  sanitizeApiLink,
  trackedCallTool,
  toolText,
} from "./directLookup.js";
import { caseNumberIncludes, caseNumberKey, normalizeCaseNumber } from "./router.js";
import { logValidation } from "./log.js";

const modelName = config.geminiModel;
const reasoningEffort = null;

async function mapWithConcurrency(values, limit, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      try {
        results[index] = { value: await callback(values[index], index) };
      } catch (error) {
        results[index] = { error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}
function courtWeight(court) {
  const name = String(court || "");
  if (name.includes("대법원") || name.includes("헌법재판소") || name.includes("헌재")) return 5;
  if (name.includes("고등법원") || name.includes("고법")) return 3;
  return 1;
}
// Product Gemini D pipeline ends here.
function dateNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{8}$/.test(digits) ? Number(digits) : 0;
}

export function rankCandidates(candidates, { applyPreviewPenalty = false } = {}) {
  const dates = candidates.map((candidate) => dateNumber(candidate.date)).filter(Boolean);
  const minDate = dates.length > 0 ? Math.min(...dates) : 0;
  const maxDate = dates.length > 0 ? Math.max(...dates) : 0;
  return candidates
    .map((candidate) => {
      const currentDate = dateNumber(candidate.date);
      const recency = maxDate > minDate && currentDate > 0 ? (currentDate - minDate) / (maxDate - minDate) : 0;
      const previewPenalty = applyPreviewPenalty && !String(candidate.preview || "").trim()
        ? config.previewMissingPenalty
        : 0;
      const score = (candidate.matchedKeywords.size * 10) + courtWeight(candidate.court) + recency - previewPenalty;
      return { ...candidate, score, recency };
    })
    .sort((left, right) => right.score - left.score || dateNumber(right.date) - dateNumber(left.date) || left.caseNumber.localeCompare(right.caseNumber) || String(left.id).localeCompare(String(right.id)))
    .slice(0, config.candidateMax);
}

async function previewCandidate(candidate, telemetry = null) {
  try {
    const result = await trackedCallTool("get_decision_text", {
      domain: candidate.domain,
      id: candidate.id,
      full: false,
    }, telemetry);
    const text = toolText(result);
    const detail = parseDecisionDetail(text);
    const valid = !result.isError
      && !text.includes("[NOT_FOUND]")
      && !text.includes("[HALLUCINATION_DETECTED]")
      && caseNumberIncludes(detail.caseNumber, candidate.caseNumber);
    return {
      ...candidate,
      preview: detail.sections?.판시사항?.slice(0, 300) || "",
      prefetched: { result, text, detail, valid },
    };
  } catch {
    return { ...candidate, preview: "" };
  }
}

export function fallbackPlan(query) {
  return { keywords: [query], law_names: [], domains: ["precedent"] };
}

export function getFallbackLabel(error) {
  return error?.code === "GEMINI_LIMIT_EXCEEDED" && ["일일 한도", "분당 한도"].includes(error.reason)
    ? "오늘의 AI 분석 한도에 도달했습니다. 결정론 검색 결과만 표시합니다."
    : "AI 선별 없이 검색 결과만 표시합니다.";
}

export async function collectCandidates(plan, telemetry = null) {
  const jobs = plan.keywords.flatMap((keyword) => plan.domains.map((domain) => ({ keyword, domain })));
  const searchResults = await mapWithConcurrency(jobs, config.searchConcurrency, async (job) => {
    const result = await trackedCallTool("search_decisions", {
      domain: job.domain,
      query: job.keyword,
      display: config.searchDisplay,
      options: { search: 2 },
    }, telemetry);
    return { ...job, result };
  });
  const byCaseNumber = new Map();
  const queryStats = [];
  for (const [queryIndex, entry] of searchResults.entries()) {
    const job = jobs[queryIndex];
    const rawText = entry.value?.result ? toolText(entry.value.result) : "";
    const parsedResults = rawText && !rawText.includes("[NOT_FOUND]")
      ? parseDecisionSearchResults(rawText)
      : [];
    const uniqueQueryKeys = new Set(parsedResults
      .map((item) => normalizeCaseNumber(item.caseNumber))
      .filter(Boolean)
      .map(caseNumberKey));
    if (telemetry?.dTrace && job) {
      queryStats.push({
        query_index: queryIndex,
        query_hash: hashTraceValue(`${job.domain}\u0000${job.keyword}`),
        domain: job.domain,
        reported_total_results: null,
        exposed_result_count: parsedResults.length,
        unique_candidate_yield: uniqueQueryKeys.size,
        duplicate_candidate_yield: Math.max(0, parsedResults.length - uniqueQueryKeys.size),
        is_error: Boolean(entry.error || entry.value?.result?.isError),
      });
    }
    if (entry.error || entry.value?.result?.isError) continue;
    const text = rawText;
    if (!text || text.includes("[NOT_FOUND]")) continue;
    for (const item of parsedResults) {
      const caseNumber = normalizeCaseNumber(item.caseNumber);
      if (!caseNumber) continue;
      const key = caseNumberKey(caseNumber);
      const existing = byCaseNumber.get(key);
      if (existing) {
        existing.matchedKeywords.add(entry.value.keyword);
        continue;
      }
      byCaseNumber.set(key, {
        ...item,
        caseNumber,
        domain: entry.value.domain,
        matchedKeywords: new Set([entry.value.keyword]),
      });
    }
  }
  if (telemetry?.dTrace) {
    telemetry.dTrace.search_queries = queryStats;
    const resultCounts = queryStats.map((query) => query.exposed_result_count);
    const yields = queryStats.map((query) => query.unique_candidate_yield);
    const nonzero = resultCounts.filter((value) => value > 0);
    const highResultThreshold = config.searchDisplay;
    const yieldMean = yields.length === 0 ? 0 : yields.reduce((sum, value) => sum + value, 0) / yields.length;
    telemetry.dTrace.search_dispersion = {
      zero_result_query_count: resultCounts.filter((value) => value === 0).length,
      nonzero_result_query_count: nonzero.length,
      high_result_query_count: resultCounts.filter((value) => value >= highResultThreshold).length,
      high_result_threshold: highResultThreshold,
      result_count: numericSummary(resultCounts),
      unique_candidate_yield: numericSummary(yields),
      candidate_yield_stddev: yields.length === 0
        ? null
        : Math.sqrt(yields.reduce((sum, value) => sum + ((value - yieldMean) ** 2), 0) / yields.length),
    };
    const rawCandidates = [...byCaseNumber.values()];
    telemetry.dTrace.candidates.raw_summary = candidateSummary(rawCandidates);
    telemetry.dTrace.candidates.raw_candidate_count = rawCandidates.length;
    telemetry.dTrace.candidates.single_query_candidate_ratio = rawCandidates.length === 0
      ? null
      : rawCandidates.filter((candidate) => candidateKeywordCount(candidate) === 1).length / rawCandidates.length;
    telemetry.dTrace.candidates.multi_query_candidate_ratio = rawCandidates.length === 0
      ? null
      : rawCandidates.filter((candidate) => candidateKeywordCount(candidate) > 1).length / rawCandidates.length;
  }
  return [...byCaseNumber.values()];
}

function normalizeLawName(value) {
  return String(value || "").replace(/\s+/gu, "").replace(/^대한민국헌법$/u, "헌법");
}

function hashTraceValue(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function numericSummary(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { mean: null, median: null, min: null, max: null };
  const sorted = [...finite].sort((left, right) => left - right);
  const middle = (sorted.length - 1) / 2;
  const lower = Math.floor(middle);
  const upper = Math.ceil(middle);
  return {
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    median: lower === upper ? sorted[lower] : (sorted[lower] + sorted[upper]) / 2,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}
function candidateKeywordCount(candidate) {
  return candidate?.matchedKeywords instanceof Set
    ? candidate.matchedKeywords.size
    : Array.isArray(candidate?.matchedKeywords) ? candidate.matchedKeywords.length : 0;
}

function candidateSummary(candidates) {
  const keywordCounts = candidates.map(candidateKeywordCount);
  return {
    count: candidates.length,
    matched_keywords: numericSummary(keywordCounts),
    preview_present_count: candidates.filter((candidate) => Boolean(String(candidate.preview || "").trim())).length,
    preview_missing_count: candidates.filter((candidate) => !String(candidate.preview || "").trim()).length,
  };
}

function rankingSummary(candidates) {
  const scores = candidates.slice(0, 5).map((candidate) => Number(candidate.score)).filter(Number.isFinite);
  const rank1 = scores[0] ?? null;
  const rank2 = scores[1] ?? null;
  const rank3 = scores[2] ?? null;
  const rank12 = rank1 === null || rank2 === null ? null : rank1 - rank2;
  const rank13 = rank1 === null || rank3 === null ? null : rank1 - rank3;
  const mean = scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance = scores.length === 0 ? null : scores.reduce((sum, score) => sum + ((score - mean) ** 2), 0) / scores.length;
  return {
    rank1_score: rank1,
    rank2_score: rank2,
    rank3_score: rank3,
    rank1_rank2_margin: rank12,
    rank1_rank3_margin: rank13,
    rank1_rank2_margin_ratio: rank12 === null || rank1 === 0 ? null : rank12 / Math.abs(rank1),
    top5_score_mean: mean,
    top5_score_stddev: variance === null ? null : Math.sqrt(variance),
  };
}

function createDTrace() {
  return {
    schema_version: "m6e-d-trace-v1",
    plan: null,
    search_queries: [],
    search_dispersion: null,
    candidates: {
      raw_candidate_count: null,
      initial_ranked_candidate_count: null,
      preview_candidate_count: null,
      final_ranked_candidate_count: null,
      verified_candidate_count: null,
      raw_summary: null,
      top5_summary: null,
      raw_selected_summary: null,
      ranking: null,
    },
    raw_selection: null,
    final_selection: null,
    validator: null,
  };
}

function recordSelectionTrace(trace, selection, candidates) {
  if (!trace) return;
  const selected = Array.isArray(selection?.selected) ? selection.selected : [];
  const selectedCandidates = selected
    .map((item) => candidates.find((candidate) => caseNumberIncludes(candidate.caseNumber, item.case_no)))
    .filter(Boolean);
  const keywordCounts = selectedCandidates.map(candidateKeywordCount);
  const previewPresent = selectedCandidates.filter((candidate) => Boolean(String(candidate.preview || "").trim())).length;
  trace.raw_selection = {
    raw_selected_count: selected.length,
    raw_direct_count: selected.filter((item) => item.match === "direct").length,
    raw_related_count: selected.filter((item) => item.match === "related").length,
    raw_direct_ratio: selected.length === 0 ? null : selected.filter((item) => item.match === "direct").length / selected.length,
    raw_selection_empty: selected.length === 0,
    raw_selected_case_key_hashes: selected
      .map((item) => caseNumberKey(item.case_no))
      .filter(Boolean)
      .map(hashTraceValue),
    raw_selected_matched_keywords: numericSummary(keywordCounts),
    raw_selected_preview_present_count: previewPresent,
    raw_selected_preview_missing_count: selectedCandidates.length - previewPresent,
  };
}

async function searchRelatedLaws(plan, telemetry = null) {
  const entries = await mapWithConcurrency(plan.law_names, config.searchConcurrency, async (lawName) => {
    const result = await trackedCallTool("search_law", {
      query: lawName,
      display: config.lawSearchDisplay,
    }, telemetry);
    if (result.isError) return null;
    const target = normalizeLawName(lawName);
    const candidate = parseLawSearchResults(toolText(result)).find(
      (item) => normalizeLawName(item.title) === target,
    );
    if (!candidate || (!candidate.mst && !candidate.link)) return null;
    return {
      lawName: candidate.title,
      article: "",
      text: "",
      link: sanitizeApiLink(candidate.link, candidate.mst) || lawDetailLink(candidate.mst),
    };
  });
  const seen = new Set();
  return entries
    .filter((entry) => !entry.error && entry.value)
    .map((entry) => entry.value)
    .filter((reference) => {
      const key = normalizeLawName(reference.lawName);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function lookupQueryLawReferences(query, telemetry = null) {
  if (parseStatuteReferences(query).length === 0) return [];
  return enrichLawReferences(query, telemetry);
}

function closedWorldSelections(selection, candidates) {
  const seen = new Set();
  const rejected = [];
  const selected = selection.selected.flatMap((item) => {
    const caseNumber = normalizeCaseNumber(item.case_no);
    const candidate = candidates.find((entry) => caseNumberIncludes(entry.caseNumber, caseNumber));
    const key = candidate ? caseNumberKey(candidate.caseNumber) : caseNumberKey(caseNumber);
    if (!candidate || seen.has(key)) {
      rejected.push(caseNumber || "(빈 사건번호)");
      return [];
    }
    seen.add(key);
    return [{ ...candidate, match: item.match }];
  });
  return { selected, rejected };
}

export async function prepareCandidates(candidates, telemetry = null) {
  const initialCandidates = rankCandidates(candidates);
  if (telemetry?.dTrace) {
    telemetry.dTrace.candidates.initial_ranked_candidate_count = initialCandidates.length;
    telemetry.dTrace.candidates.top5_summary = candidateSummary(initialCandidates.slice(0, 5));
    telemetry.dTrace.candidates.ranking = rankingSummary(initialCandidates);
  }
  const previewEntries = await mapWithConcurrency(initialCandidates, config.searchConcurrency, (candidate) => previewCandidate(candidate, telemetry));
  const previewCandidates = previewEntries.filter((entry) => !entry.error).map((entry) => entry.value);
  if (telemetry?.dTrace) {
    const top5Preview = previewEntries.slice(0, 5).filter((entry) => !entry.error).map((entry) => entry.value);
    telemetry.dTrace.candidates.preview_candidate_count = previewCandidates.length;
    telemetry.dTrace.candidates.top5_preview_present_count = top5Preview.filter((candidate) => Boolean(String(candidate.preview || "").trim())).length;
    telemetry.dTrace.candidates.top5_preview_missing_count = top5Preview.length - telemetry.dTrace.candidates.top5_preview_present_count;
    telemetry.dTrace.candidates.top5_preview_missing_ratio = top5Preview.length === 0
      ? null
      : telemetry.dTrace.candidates.top5_preview_missing_count / top5Preview.length;
  }
  const rankedCandidates = rankCandidates(previewCandidates, { applyPreviewPenalty: true });
  if (telemetry?.dTrace) {
    telemetry.dTrace.candidates.final_ranked_candidate_count = rankedCandidates.length;
    telemetry.dTrace.candidates.ranking_after_preview_penalty = rankingSummary(rankedCandidates);
  }
  return { rankedCandidates, candidatesWithPreview: rankedCandidates };
}

export async function finalizeSelection({
  query,
  candidatesWithPreview,
  candidatePool = candidatesWithPreview,
  selection,
  fallbackLabel,
  lawReferences,
  telemetry = null,
}) {
  const safeSelection = selection || { selected: [], intro: "" };
  const closedWorld = closedWorldSelections(safeSelection, candidatePool);
  for (const rejectedCaseNumber of closedWorld.rejected) {
    await logValidation(query, rejectedCaseNumber, "Gemini 선별 결과가 후보 목록 밖이어서 제외했습니다.");
  }
  let selectedCandidates = closedWorld.selected;
  if (selectedCandidates.length === 0) {
    selectedCandidates = candidatesWithPreview.slice(0, Math.min(3, config.resultMax)).map((candidate) => ({ ...candidate, match: "related" }));
  }

  const detailResults = await mapWithConcurrency(selectedCandidates, config.searchConcurrency, async (candidate) => {
    const prefetched = candidate.prefetched?.valid ? candidate.prefetched : null;
    return lookupDecisionCandidate(candidate, candidate.domain, prefetched, telemetry);
  });
  const items = detailResults.map((entry, index) => ({
    ...(entry.value || {
      status: "validation_failed",
      caseNumber: selectedCandidates[index].caseNumber,
      candidateCaseNumbers: [selectedCandidates[index].caseNumber],
      detail: { rawText: "" },
      lawReferences: [],
    }),
    match: selectedCandidates[index].match,
  }));

  return {
    route: "natural",
    query,
    intro: safeSelection.intro,
    fallbackLabel,
    lawReferences,
    candidateCaseNumbers: candidatePool.map((candidate) => candidate.caseNumber),
    selected: selectedCandidates.map((candidate) => ({ caseNumber: candidate.caseNumber, match: candidate.match })),
    items,
  };
}

export async function runDeterministicPipeline(query, dependencies = {}) {
  const startedAt = Date.now();
  const reportProgress = typeof dependencies.onProgress === "function" ? dependencies.onProgress : () => {};
  const pinnedRuntime = dependencies.runtime || {};
  const effectiveRuntimeName = dependencies.runtimeName || pinnedRuntime.runtimeName || runtimeName;
  const effectiveModelName = dependencies.modelName || pinnedRuntime.modelName || modelName;
  const effectiveReasoningEffort = dependencies.reasoningEffort === undefined
    ? (pinnedRuntime.reasoningEffort === undefined ? reasoningEffort : pinnedRuntime.reasoningEffort)
    : dependencies.reasoningEffort;
  const traceEnabled = process.env.M6E_D_TRACE === "1";
  const dTrace = traceEnabled ? createDTrace() : null;
  const telemetry = {
    runtime: effectiveRuntimeName,
    model: effectiveModelName,
    reasoningEffort: effectiveReasoningEffort,
    geminiRequests: 0,
    geminiRetryRequests: 0,
    geminiRpmWaitEvents: 0,
    geminiRpmWaitMs: 0,
    geminiInputTokens: 0,
    geminiOutputTokens: 0,
    codexRequests: 0,
    codexInputTokens: 0,
    codexCachedInputTokens: 0,
    codexOutputTokens: 0,
    codexReasoningTokens: 0,
    codexCreditEquivalent: 0,
    codexApiEquivalentUsd: 0,
    codexHandoffApiEquivalentUsd: 0,
    codexElapsedMs: 0,
    mcpCallsTotal: 0,
    mcpSearchCalls: 0,
    mcpDetailCalls: 0,
    elapsedMs: 0,
    dTrace,
  };
  const generatePlanFn = dependencies.generatePlan || pinnedRuntime.generatePlan || generatePlan;
  const collectCandidatesFn = dependencies.collectCandidates || collectCandidates;
  const searchRelatedLawsFn = dependencies.searchRelatedLaws || searchRelatedLaws;
  const lookupQueryLawReferencesFn = dependencies.lookupQueryLawReferences || lookupQueryLawReferences;
  const prepareCandidatesFn = dependencies.prepareCandidates || prepareCandidates;
  const selectCandidatesFn = dependencies.selectCandidates || pinnedRuntime.selectCandidates || selectCandidates;
  const finalizeSelectionFn = dependencies.finalizeSelection || finalizeSelection;
  let plan;
  let fallbackLabel = "";
  try {
    plan = await generatePlanFn(query, telemetry);
  } catch (error) {
    plan = fallbackPlan(query);
    fallbackLabel = getFallbackLabel(error);
  }
  if (dTrace) {
    dTrace.plan = {
      keyword_count: plan.keywords.length,
      domain_count: plan.domains.length,
      law_name_count: plan.law_names.length,
    };
  }
  reportProgress("ANALYSIS_COMPLETE");

  const [rawCandidates, planLawReferences, queryLawReferences] = await Promise.all([
    collectCandidatesFn(plan, telemetry),
    searchRelatedLawsFn(plan, telemetry),
    lookupQueryLawReferencesFn(query, telemetry),
  ]);
  if (dTrace && dTrace.candidates.raw_candidate_count === null) {
    dTrace.candidates.raw_candidate_count = rawCandidates.length;
    dTrace.candidates.raw_summary = candidateSummary(rawCandidates);
  }
  const lawReferences = queryLawReferences.length > 0 ? queryLawReferences : planLawReferences;
  reportProgress("LAW_EVIDENCE_UPDATED", {
    candidateCount: rawCandidates.length,
    lawCount: lawReferences.length,
  });
  reportProgress("CANDIDATES_FOUND", {
    candidateCount: rawCandidates.length,
    lawCount: lawReferences.length,
  });
  const prepared = await prepareCandidatesFn(rawCandidates, telemetry);
  let selection;
  try {
    selection = await selectCandidatesFn(query, prepared.candidatesWithPreview, telemetry);
  } catch (error) {
    selection = { selected: [], intro: "" };
    fallbackLabel = getFallbackLabel(error);
  }
  recordSelectionTrace(dTrace, selection, prepared.candidatesWithPreview);
  reportProgress("FINALIZING", {
    candidateCount: prepared.candidatesWithPreview.length,
    lawCount: lawReferences.length,
  });
  const finalResult = await finalizeSelectionFn({
    query,
    candidatesWithPreview: prepared.candidatesWithPreview,
    candidatePool: prepared.rankedCandidates,
    selection,
    fallbackLabel,
    lawReferences,
    telemetry,
  });
  reportProgress("DETAIL_VERIFIED", {
    candidateCount: prepared.candidatesWithPreview.length,
    verifiedCount: (finalResult.items || []).filter((item) => item.status === "verified").length,
    lawCount: lawReferences.length,
  });
  if (dTrace) {
    const finalSelected = Array.isArray(finalResult.selected) ? finalResult.selected : [];
    dTrace.final_selection = {
      final_selected_count: finalSelected.length,
      final_direct_count: finalSelected.filter((item) => item.match === "direct").length,
      final_related_count: finalSelected.filter((item) => item.match === "related").length,
      final_selected_case_key_hashes: finalSelected.map((item) => hashTraceValue(caseNumberKey(item.caseNumber))),
      ranked_fill_applied: Boolean(dTrace.raw_selection?.raw_selection_empty && finalSelected.length > 0),
      selected_verified_count: (finalResult.items || []).filter((item) => item.status === "verified").length,
      selected_validation_failed_count: (finalResult.items || []).filter((item) => item.status !== "verified").length,
    };
    dTrace.candidates.verified_candidate_count = dTrace.final_selection.selected_verified_count;
  }
  telemetry.elapsedMs = Date.now() - startedAt;
  return {
    ...finalResult,
    metrics: {
      gemini_requests: telemetry.geminiRequests,
      gemini_retry_requests: telemetry.geminiRetryRequests,
      gemini_rpm_wait_events: telemetry.geminiRpmWaitEvents,
      gemini_rpm_wait_ms: telemetry.geminiRpmWaitMs,
      gemini_input_tokens: telemetry.geminiInputTokens,
      gemini_output_tokens: telemetry.geminiOutputTokens,
      runtime: telemetry.runtime,
      model: telemetry.model,
      reasoning_effort: telemetry.reasoningEffort,
      codex_requests: telemetry.codexRequests,
      codex_input_tokens: telemetry.codexInputTokens,
      codex_cached_input_tokens: telemetry.codexCachedInputTokens,
      codex_output_tokens: telemetry.codexOutputTokens,
      codex_reasoning_tokens: telemetry.codexReasoningTokens,
      codex_credit_equivalent: telemetry.codexCreditEquivalent,
      api_equivalent_usd: telemetry.codexApiEquivalentUsd,
      api_equivalent_usd_handoff_snapshot: telemetry.codexHandoffApiEquivalentUsd,
      codex_elapsed_ms: telemetry.codexElapsedMs,
      mcp_calls_total: telemetry.mcpCallsTotal,
      mcp_search_calls: telemetry.mcpSearchCalls,
      mcp_detail_calls: telemetry.mcpDetailCalls,
      elapsed_ms: telemetry.elapsedMs,
      stop_reason: fallbackLabel ? "FALLBACK_ERROR" : "MODEL_FINAL",
      fallback_used: Boolean(fallbackLabel),
    },
    ...(dTrace ? { d_trace: dTrace } : {}),
  };
}
