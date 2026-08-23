export const SEARCH_PROGRESS_EVENTS = Object.freeze([
  "SEARCH_STARTED",
  "ROUTE_IDENTIFIED",
  "ANALYSIS_COMPLETE",
  "LAW_EVIDENCE_UPDATED",
  "CANDIDATES_FOUND",
  "DETAIL_VERIFIED",
  "FINALIZING",
  "MODEL_FALLBACK",
  "SEARCH_COMPLETE",
  "SEARCH_FAILED",
]);

const EVENT_RANK = Object.freeze({
  SEARCH_STARTED: 0,
  ROUTE_IDENTIFIED: 1,
  ANALYSIS_COMPLETE: 2,
  LAW_EVIDENCE_UPDATED: 3,
  CANDIDATES_FOUND: 4,
  DETAIL_VERIFIED: 5,
  FINALIZING: 6,
  MODEL_FALLBACK: 6,
  SEARCH_COMPLETE: 7,
  SEARCH_FAILED: 7,
});

const EVENT_PERCENT = Object.freeze({
  SEARCH_STARTED: 0,
  ROUTE_IDENTIFIED: 12,
  ANALYSIS_COMPLETE: 25,
  LAW_EVIDENCE_UPDATED: 40,
  CANDIDATES_FOUND: 55,
  DETAIL_VERIFIED: 75,
  FINALIZING: 90,
  MODEL_FALLBACK: 90,
  SEARCH_COMPLETE: 100,
  SEARCH_FAILED: 100,
});

const EVENT_LABEL = Object.freeze({
  SEARCH_STARTED: "검색을 시작했습니다.",
  ROUTE_IDENTIFIED: "질문 유형을 확인했습니다.",
  ANALYSIS_COMPLETE: "질문을 분석했습니다.",
  LAW_EVIDENCE_UPDATED: "법령 근거 확인 중",
  CANDIDATES_FOUND: "판례 후보를 찾고 있습니다.",
  DETAIL_VERIFIED: "판례 원문을 검증하고 있습니다.",
  FINALIZING: "검증된 결과를 정리하고 있습니다.",
  MODEL_FALLBACK: "사용 가능한 모델로 검색을 이어가고 있습니다.",
  SEARCH_COMPLETE: "검색을 완료했습니다.",
  SEARCH_FAILED: "검색을 완료하지 못했습니다.",
});

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function safeRoute(value) {
  return value === "direct" || value === "natural" ? value : "";
}

function safeText(value) {
  return typeof value === "string" && value.length <= 120 ? value : null;
}

export function createProgressReporter(onProgress = () => {}) {
  let lastRank = -1;
  let last = null;

  function emit(event, details = {}) {
    if (!SEARCH_PROGRESS_EVENTS.includes(event)) return null;
    const rank = EVENT_RANK[event];
    if (rank < lastRank && event !== "SEARCH_FAILED") return last;
    lastRank = Math.max(lastRank, rank);
    last = Object.freeze({
      event,
      label: EVENT_LABEL[event],
      percent: EVENT_PERCENT[event],
      route: safeRoute(details.route),
      route_reason: safeText(details.route_reason),
      candidate_raw: safeText(details.candidate_raw),
      candidate_normalized: safeText(details.candidate_normalized),
      candidate_case_code: safeText(details.candidate_case_code),
      candidate_rejection_reason: safeText(details.candidate_rejection_reason),
      candidateCount: count(details.candidateCount),
      verifiedCount: count(details.verifiedCount),
      lawCount: count(details.lawCount),
      fallbackApplied: details.fallbackApplied === true,
      requestedModel: safeText(details.requestedModel),
      effectiveModel: safeText(details.effectiveModel),
    });
    onProgress(last);
    return last;
  }

  return {
    emit,
    get last() {
      return last;
    },
  };
}

export function progressRank(event) {
  return EVENT_RANK[event] ?? -1;
}
