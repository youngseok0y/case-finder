import { extractCaseNumbers, normalizeCaseNumber } from "../router.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

const LAW_ARTICLE_PATTERN = /(?<!\d)(?:제)?\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?/gu;
const GENERIC_PROVIDER_CASE_PATTERN = /(?<!\d)((?:19|20)\d{2}|\d{2})\s*([가-힣]{1,4})\s*(\d{1,7})(?!\d)/gu;
const NON_CASE_HANGUL_CODES = new Set(["년", "년도", "월", "일", "조", "항", "호", "개", "명", "회", "세", "시", "분", "초", "원", "만원"]);

export function normalizeLawArticle(value) {
  const source = text(value).replace(/\s+/gu, "");
  const match = source.match(/^(?:제)?(\d{1,4})조(?:의(\d{1,2}))?/u);
  if (!match) return "";
  return `제${Number.parseInt(match[1], 10)}조${match[2] ? `의${Number.parseInt(match[2], 10)}` : ""}`;
}

function narrativeSegments(value) {
  const segments = text(value)
    .split(/(?<=[.!?。！？])\s*|\r?\n+/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments : [text(value)];
}

function narrativeCaseReferences(value) {
  const references = extractCaseNumbers(value).map((reference) => ({
    caseNumber: reference.caseNumber,
    raw: reference.raw,
  }));
  const seen = new Set(references.map((reference) => normalizeCaseNumber(reference.caseNumber)));
  for (const match of value.matchAll(GENERIC_PROVIDER_CASE_PATTERN)) {
    if (NON_CASE_HANGUL_CODES.has(match[2])) continue;
    const caseNumber = normalizeCaseNumber(match[0]);
    if (!caseNumber || seen.has(caseNumber)) continue;
    seen.add(caseNumber);
    references.push({ caseNumber, raw: match[0] });
  }
  return references;
}

const LAW_NAME_ARTICLE_PATTERN = /([\uAC00-\uD7A3A-Za-z0-9\u00B7]+) +((?:\uC81C)?[0-9]+\uC870(?:\uC758[0-9]+)?(?:\uC81C[0-9]+\uD56D)?(?:\uC81C[0-9]+\uD638)?)/gu;

function narrativeLawReferences(value) {
  return [...value.matchAll(LAW_NAME_ARTICLE_PATTERN)].map((match) => ({
    lawName: text(match[1]),
    article: normalizeLawArticle(match[2]),
  })).filter((reference) => reference.lawName && reference.article);
}

export function sanitizeEvidenceNarrative(intro, {
  isCaseVerified = () => false,
  isLawArticleOpened = () => false,
} = {}) {
  const source = text(intro);
  if (!source) return { text: "", sanitized: false, diagnostics: [], references: [] };
  const diagnostics = new Set();
  const references = [];
  const safeSegments = narrativeSegments(source).filter((segment) => {
    let safe = true;
    const lawReferences = narrativeLawReferences(segment);
    for (const reference of narrativeCaseReferences(segment)) {
      references.push({ claimType: "case", normalizedReference: reference.caseNumber });
      if (!isCaseVerified(reference.caseNumber)) {
        diagnostics.add("INTRO_UNVERIFIED_CASE_REFERENCE_REMOVED");
        safe = false;
      }
    }
    for (const match of segment.matchAll(LAW_ARTICLE_PATTERN)) {
      const article = normalizeLawArticle(match[0]);
      const lawReference = lawReferences.find((reference) => reference.article === article) || {};
      if (article) references.push({ claimType: "law", normalizedReference: article, lawName: lawReference.lawName || "" });
      if (article && !isLawArticleOpened(article, lawReference)) {
        diagnostics.add("INTRO_UNVERIFIED_LAW_ARTICLE_REMOVED");
        safe = false;
      }
    }
    return safe;
  });
  return {
    text: safeSegments.join(" ").trim(),
    sanitized: diagnostics.size > 0,
    diagnostics: [...diagnostics].map((code) => ({ code })),
    references,
  };
}

export function finalizeSelection(selection, ledger, { resultMax = 5 } = {}) {
  const selected = Array.isArray(selection?.selected) ? selection.selected : [];
  const selectionShapeValid = Array.isArray(selection?.selected) && typeof selection?.intro === "string";
  const rejectedSelected = [];
  const eligibleSelected = [];
  const seen = new Set();

  for (const item of selected.slice(0, resultMax)) {
    const caseNumber = normalizeCaseNumber(text(item?.case_no || item?.caseNumber));
    const match = text(item?.match);
    if (!caseNumber) {
      rejectedSelected.push({ case_no: text(item?.case_no || item?.caseNumber), match, reason: "INVALID_CASE_NUMBER" });
      continue;
    }
    if (match !== "direct" && match !== "related") {
      rejectedSelected.push({ case_no: caseNumber, match, reason: "INVALID_MATCH" });
      continue;
    }
    const candidate = ledger.getCase(caseNumber);
    if (!candidate) {
      rejectedSelected.push({ case_no: caseNumber, match, reason: "CASE_NOT_OBSERVED" });
      continue;
    }
    if (!candidate.detailVerified) {
      rejectedSelected.push({ case_no: candidate.caseNumber, match, reason: "NOT_DETAIL_VERIFIED" });
      continue;
    }
    if (seen.has(candidate.caseKey)) {
      rejectedSelected.push({ case_no: candidate.caseNumber, match, reason: "DUPLICATE_CASE" });
      continue;
    }
    seen.add(candidate.caseKey);
    eligibleSelected.push({ case_no: candidate.caseNumber, match });
  }

  ledger.recordSelectionAttempt(selection);
  const protocolDiagnostics = rejectedSelected.map((item) => ({
    code: item.reason === "NOT_DETAIL_VERIFIED" ? "MODEL_UNVERIFIED_SELECTION_ATTEMPT" : item.reason,
    case_no: item.case_no,
  }));
  const narrative = sanitizeEvidenceNarrative(selection?.intro, {
    isCaseVerified: (caseNumber) => Boolean(ledger.isFinalEligible?.(caseNumber)),
    isLawArticleOpened: (article, context = {}) => Boolean(ledger.isLawArticleOpened?.({ ...context, article })),
  });
  const intro = narrative.text;
  ledger.recordClaimReferences?.({
    claims: [
      ...eligibleSelected.map((item) => ({ claimType: "case", normalizedReference: item.case_no })),
      ...rejectedSelected.map((item) => ({
        claimType: "case",
        normalizedReference: item.case_no,
        status: "removed",
        reason: item.reason,
      })),
      ...(narrative.references || []),
    ],
  });
  protocolDiagnostics.push(...narrative.diagnostics);
  const selectionRepaired = !selectionShapeValid || rejectedSelected.length > 0 || narrative.sanitized || selected.length > resultMax;
  const outputValid = true;
  const modelProtocolClean = selectionShapeValid && rejectedSelected.length === 0 && selected.length <= resultMax;
  if (selected.length > resultMax) protocolDiagnostics.push({ code: "RESULT_MAX_TRUNCATED" });
  return {
    selected: eligibleSelected,
    intro,
    rejectedSelected,
    protocolDiagnostics,
    output_valid: outputValid,
    model_protocol_clean: modelProtocolClean,
    selection_repaired: selectionRepaired,
    protocolPass: outputValid && modelProtocolClean,
  };
}

export function createFinalSelectionGate({ ledger, resultMax = 5 } = {}) {
  if (!ledger) throw new Error("FINAL_SELECTION_GATE_LEDGER_REQUIRED");
  return {
    finalize(selection) {
      return finalizeSelection(selection, ledger, { resultMax });
    },
  };
}

export const FinalSelectionGate = Object.freeze({ finalizeSelection });
