import { expandCaseIdentitySet, normalizeCaseIdentityText } from "./caseIdentity.js";

const CASE_YEAR_SOURCE = String.raw`(?:\d{2}|(?:19|20)\d{2})`;
const CASE_SEPARATOR_SOURCE = String.raw`[\s\u002D\u2010-\u2015\u2212]*`;

// These are court/case-type codes used by the existing direct-lookup corpus.
// Arbitrary Hangul between a year and serial is not a supported identifier.
export const SUPPORTED_CASE_CODES = Object.freeze([
  "재가합", "재가단", "재나", "재다", "재도", "재두", "재마", "재모", "재허",
  "가합", "가단", "가소", "고합", "고단", "구합", "구단",
  "헌가", "헌나", "헌다", "헌라", "헌마", "헌바", "헌사", "헌아", "헌재",
  "나", "다", "더", "러", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하",
  "고", "노", "도", "로", "모", "므", "보", "오", "우", "초", "허", "후",
  "구", "누", "두", "루", "무", "부", "전", "정", "당",
].sort((left, right) => right.length - left.length));

const CASE_CODE_SOURCE = SUPPORTED_CASE_CODES.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const CASE_NUMBER_SOURCE = String.raw`(${CASE_YEAR_SOURCE})${CASE_SEPARATOR_SOURCE}(${CASE_CODE_SOURCE})${CASE_SEPARATOR_SOURCE}(\d{1,7})`;
const CASE_NO = new RegExp(String.raw`(?<!\d)${CASE_NUMBER_SOURCE}(?!\d)`, "gu");
const FULL_CASE_NUMBER = new RegExp(String.raw`^(?:[가-힣]+${CASE_SEPARATOR_SOURCE})?${CASE_NUMBER_SOURCE}$`, "u");
const GENERIC_CASE_LIKE = new RegExp(String.raw`(?<!\d)(\d{2,4})${CASE_SEPARATOR_SOURCE}([가-힣]{1,3})${CASE_SEPARATOR_SOURCE}(\d{1,7})(?!\d)`, "u");
const DATE_LIKE = /(?:(?:19|20)\d{2}\s*년\s*\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?|(?:19|20)\d{2}[.-]\d{1,2}[.-]\d{1,2})/u;
const STATUTE_LIKE = /(?:제)?\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?/u;
const QUANTITY_LIKE = /\d+(?:여\s*)?(?:개|명|회|세|시|분|초|원|만원|%)/u;
const RELATED_SEARCH_INTENT = [
  /(?:유사한|비슷한|관련)\s*(?:판례|사건|결정)/u,
  /같은\s*쟁점의\s*(?:판례|사건|결정)/u,
  /다른\s*(?:판례|사건|결정)/u,
  /이\s*(?:사건|판결)\s*(?:외에|말고)/u,
  /이\s*(?:사건|판결)\s*(?:을|를)?\s*제외하고/u,
  /비교해?(?:줘)?/u,
];
const EXCLUSION_INTENT = /(?:이\s*(?:사건|판결)\s*(?:외에|말고|(?:을|를)?\s*제외하고)|제외하고)/u;

function candidateRejectionReason(source) {
  if (DATE_LIKE.test(source)) return "date_like_token";
  if (STATUTE_LIKE.test(source)) return "statute_like_token";
  if (QUANTITY_LIKE.test(source)) return "quantity_like_token";
  if (GENERIC_CASE_LIKE.test(source)) return "unsupported_case_code";
  return "no_valid_case_identifier";
}

function routeTelemetry({ kind, reason, matches, relatedSearchIntent, exclusionIntent }) {
  const single = matches.length === 1 ? matches[0] : null;
  return {
    route_reason: reason,
    candidate_raw: kind === "direct" ? single.raw : null,
    candidate_normalized: kind === "direct" ? single.caseNumber : null,
    candidate_case_code: kind === "direct" ? single.typeCode : null,
    candidate_rejection_reason: kind === "natural" ? reason : null,
    valid_candidate_count: matches.length,
    related_search_intent: relatedSearchIntent,
    exclusion_intent: exclusionIntent,
  };
}

export function normalizeCaseNumber(value) {
  return normalizeCaseIdentityText(value);
}

export function parseCaseNumber(value) {
  const match = String(value || "").trim().match(FULL_CASE_NUMBER);
  if (!match) return null;
  return {
    year: match[1],
    typeCode: match[2],
    serial: match[3],
    caseNumber: `${match[1]}${match[2]}${match[3]}`,
  };
}

export function expandCaseNumberSet(value) {
  return expandCaseIdentitySet(value);
}

export function caseNumberKey(value) {
  const expanded = expandCaseNumberSet(value);
  return expanded.size > 0 ? [...expanded].sort().join("|") : normalizeCaseNumber(value);
}

export function caseNumberIncludes(container, expected) {
  const expectedSet = expandCaseNumberSet(expected);
  const containerSet = expandCaseNumberSet(container);
  if (expectedSet.size === 0 || containerSet.size === 0) {
    return normalizeCaseNumber(container) === normalizeCaseNumber(expected);
  }
  return [...expectedSet].every((caseNumber) => containerSet.has(caseNumber));
}

export function caseNumberMatches(left, right) {
  return caseNumberIncludes(left, right) || caseNumberIncludes(right, left);
}

export function extractCaseNumbers(query) {
  const source = String(query || "");
  const matches = [];
  const seen = new Set();

  for (const match of source.matchAll(CASE_NO)) {
    const caseNumber = `${match[1]}${match[2]}${match[3]}`;
    if (seen.has(caseNumber)) continue;
    seen.add(caseNumber);
    matches.push({
      raw: match[0],
      caseNumber,
      typeCode: match[2],
      domain: match[2].startsWith("헌") ? "constitutional" : "precedent",
    });
  }

  return matches;
}

export function routeQuery(query, maxCases = 5) {
  const source = String(query || "");
  const matches = extractCaseNumbers(source);
  const relatedSearchIntent = RELATED_SEARCH_INTENT.some((pattern) => pattern.test(source));
  const exclusionIntent = EXCLUSION_INTENT.test(source);
  let kind = "natural";
  let reason = candidateRejectionReason(source);

  if (matches.length === 1 && !relatedSearchIntent && !exclusionIntent) {
    kind = "direct";
    reason = "valid_case_identifier";
  } else if (matches.length > 1) {
    reason = "multiple_identifiers";
  } else if (relatedSearchIntent) {
    reason = "related_search_intent";
  } else if (exclusionIntent) {
    reason = "exclusion_intent";
  }

  return {
    kind,
    cases: kind === "direct" ? matches.slice(0, maxCases) : [],
    ignoredCaseCount: kind === "direct" ? Math.max(0, matches.length - maxCases) : 0,
    telemetry: routeTelemetry({ kind, reason, matches, relatedSearchIntent, exclusionIntent }),
  };
}
