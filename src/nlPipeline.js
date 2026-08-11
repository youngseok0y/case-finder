import { config } from "../config.js";
import { callTool } from "./mcpClient.js";
import { generatePlan, selectCandidates } from "./gemini.js";
import {
  lookupDecisionCandidate,
  enrichLawReferences,
  parseDecisionDetail,
  parseStatuteReferences,
  parseDecisionSearchResults,
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

async function previewCandidate(candidate) {
  try {
    const result = await callTool("get_decision_text", {
      domain: candidate.domain,
      id: candidate.id,
      full: false,
    });
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

export async function collectCandidates(plan) {
  const jobs = plan.keywords.flatMap((keyword) => plan.domains.map((domain) => ({ keyword, domain })));
  const searchResults = await mapWithConcurrency(jobs, config.searchConcurrency, async (job) => {
    const result = await callTool("search_decisions", {
      domain: job.domain,
      query: job.keyword,
      display: config.searchDisplay,
      options: { search: 2 },
    });
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

async function searchRelatedLaws(plan) {
  return mapWithConcurrency(plan.law_names, config.searchConcurrency, async (lawName) => callTool("search_law", {
    query: lawName,
    display: config.lawSearchDisplay,
  }));
}

export async function lookupQueryLawReferences(query) {
  if (parseStatuteReferences(query).length === 0) return [];
  return enrichLawReferences(query);
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

export async function prepareCandidates(candidates) {
  const initialCandidates = rankCandidates(candidates);
  const previewEntries = await mapWithConcurrency(initialCandidates, config.searchConcurrency, previewCandidate);
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
    return lookupDecisionCandidate(candidate, candidate.domain, prefetched);
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
  let plan;
  let fallbackLabel = "";
  try {
    plan = await generatePlan(query);
  } catch (error) {
    plan = fallbackPlan(query);
    fallbackLabel = getFallbackLabel(error);
  }

  const [rawCandidates, , lawReferences] = await Promise.all([
    collectCandidates(plan),
    searchRelatedLaws(plan),
    lookupQueryLawReferences(query),
  ]);
  const prepared = await prepareCandidates(rawCandidates);
  let selection;
  try {
    selection = await selectCandidates(query, prepared.candidatesWithPreview);
  } catch (error) {
    selection = { selected: [], intro: "" };
    fallbackLabel = getFallbackLabel(error);
  }
  return finalizeSelection({
    query,
    candidatesWithPreview: prepared.candidatesWithPreview,
    candidatePool: prepared.rankedCandidates,
    selection,
    fallbackLabel,
    lawReferences,
  });
}

export async function runNaturalPipeline(query) {
  if (config.pipelineMode === "agentic") {
    const { runAgenticPipeline } = await import("./agenticPipeline.js");
    return runAgenticPipeline(query);
  }
  return runDeterministicPipeline(query);
}
