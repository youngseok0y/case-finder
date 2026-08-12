import { config } from "../config.js";
import { generatePlan, selectCandidates } from "./gemini.js";
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
  for (const entry of searchResults) {
    if (entry.error || entry.value?.result?.isError) continue;
    const text = toolText(entry.value.result);
    if (!text || text.includes("[NOT_FOUND]")) continue;
    for (const item of parseDecisionSearchResults(text)) {
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
  return [...byCaseNumber.values()];
}

function normalizeLawName(value) {
  return String(value || "").replace(/\s+/gu, "").replace(/^대한민국헌법$/u, "헌법");
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
  const previewEntries = await mapWithConcurrency(initialCandidates, config.searchConcurrency, (candidate) => previewCandidate(candidate, telemetry));
  const previewCandidates = previewEntries.filter((entry) => !entry.error).map((entry) => entry.value);
  const rankedCandidates = rankCandidates(previewCandidates, { applyPreviewPenalty: true });
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

export async function runDeterministicPipeline(query) {
  const startedAt = Date.now();
  const telemetry = {
    geminiRequests: 0,
    geminiRetryRequests: 0,
    geminiRpmWaitEvents: 0,
    geminiRpmWaitMs: 0,
    geminiInputTokens: 0,
    geminiOutputTokens: 0,
    mcpCallsTotal: 0,
    mcpSearchCalls: 0,
    mcpDetailCalls: 0,
    elapsedMs: 0,
  };
  let plan;
  let fallbackLabel = "";
  try {
    plan = await generatePlan(query, telemetry);
  } catch (error) {
    plan = fallbackPlan(query);
    fallbackLabel = getFallbackLabel(error);
  }

  const [rawCandidates, planLawReferences, queryLawReferences] = await Promise.all([
    collectCandidates(plan, telemetry),
    searchRelatedLaws(plan, telemetry),
    lookupQueryLawReferences(query, telemetry),
  ]);
  const lawReferences = queryLawReferences.length > 0 ? queryLawReferences : planLawReferences;
  const prepared = await prepareCandidates(rawCandidates, telemetry);
  let selection;
  try {
    selection = await selectCandidates(query, prepared.candidatesWithPreview, telemetry);
  } catch (error) {
    selection = { selected: [], intro: "" };
    fallbackLabel = getFallbackLabel(error);
  }
  const finalResult = await finalizeSelection({
    query,
    candidatesWithPreview: prepared.candidatesWithPreview,
    candidatePool: prepared.rankedCandidates,
    selection,
    fallbackLabel,
    lawReferences,
    telemetry,
  });
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
      mcp_calls_total: telemetry.mcpCallsTotal,
      mcp_search_calls: telemetry.mcpSearchCalls,
      mcp_detail_calls: telemetry.mcpDetailCalls,
      elapsed_ms: telemetry.elapsedMs,
      stop_reason: fallbackLabel ? "FALLBACK_ERROR" : "MODEL_FINAL",
      fallback_used: Boolean(fallbackLabel),
    },
  };
}

export async function runNaturalPipeline(query) {
  if (config.pipelineMode === "agentic") {
    const { runAgenticPipeline } = await import("./agenticPipeline.js");
    return runAgenticPipeline(query);
  }
  return runDeterministicPipeline(query);
}
