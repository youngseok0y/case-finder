export const LEGAL_RESULT_CATEGORIES = Object.freeze({
  SUCCESS: "SUCCESS",
  NOT_FOUND: "NOT_FOUND",
  HALLUCINATION: "HALLUCINATION",
  PROVIDER_ERROR: "PROVIDER_ERROR",
  INVALID: "INVALID",
});

function isSearchTool(toolName) {
  return toolName === "search_decisions" || toolName === "search_law";
}

function hasExplicitPayload(raw) {
  return Boolean(
    Array.isArray(raw?.items)
    || Array.isArray(raw?.results)
    || Array.isArray(raw?.structuredContent?.items)
    || Array.isArray(raw?.structuredContent?.results)
    || Number.isInteger(raw?.total),
  );
}

export function classifyLegalResult(raw, {
  toolName = "",
  rawText = typeof raw?.rawText === "string" ? raw.rawText : "",
  parsedItems = false,
} = {}) {
  const source = typeof rawText === "string" && rawText
    ? rawText
    : typeof raw?.rawText === "string" ? raw.rawText : "";
  if (source.includes("[HALLUCINATION_DETECTED]")) return LEGAL_RESULT_CATEGORIES.HALLUCINATION;
  if (source.includes("[NOT_FOUND]")) return LEGAL_RESULT_CATEGORIES.NOT_FOUND;
  if (raw?.isError) return LEGAL_RESULT_CATEGORIES.PROVIDER_ERROR;
  if (isSearchTool(toolName)) {
    return hasExplicitPayload(raw) || parsedItems
      ? LEGAL_RESULT_CATEGORIES.SUCCESS
      : LEGAL_RESULT_CATEGORIES.INVALID;
  }
  return source ? LEGAL_RESULT_CATEGORIES.SUCCESS : LEGAL_RESULT_CATEGORIES.INVALID;
}

export function isCompletedLegalSearch(category) {
  return category === LEGAL_RESULT_CATEGORIES.SUCCESS || category === LEGAL_RESULT_CATEGORIES.NOT_FOUND;
}

export function isLegalResultError(category) {
  return category !== LEGAL_RESULT_CATEGORIES.SUCCESS;
}
