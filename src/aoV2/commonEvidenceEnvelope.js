import { finalizeSelection } from "./finalSelectionGate.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

const PROVIDER_CASE_NUMBER_PATTERN = /(?<!\d)((?:19|20)\d{2}|\d{2})([가-힣]{1,4})(\d{1,7})$/u;
const PROVIDER_CASE_SEPARATOR = /[\s\u002D\u2010-\u2015\u2212]+/gu;

function normalizeProviderCaseText(value) {
  return text(value).normalize("NFKC").replace(PROVIDER_CASE_SEPARATOR, "").trim();
}

export function parseProviderCaseNumber(value) {
  const source = normalizeProviderCaseText(value);
  const match = source.match(PROVIDER_CASE_NUMBER_PATTERN);
  if (!match) return null;
  return {
    year: match[1],
    typeCode: match[2],
    serial: match[3],
    caseNumber: `${match[1]}${match[2]}${match[3]}`,
  };
}

export function expandProviderCaseNumberSet(value) {
  const source = text(value).normalize("NFKC").replace(/\([^)]*\)/g, "").trim();
  if (!source) return new Set();

  const parts = source
    .split(/\s*(?:,|，|;|\/|·|및|등|외)\s*/u)
    .map((part) => part.replace(/^[\[\]()]+|[\[\]()]+$/g, "").trim())
    .filter(Boolean);
  const expanded = new Set();
  let prefix = "";

  for (const part of parts) {
    const full = parseProviderCaseNumber(part);
    if (full) {
      prefix = `${full.year}${full.typeCode}`;
      expanded.add(full.caseNumber);
      continue;
    }
    const abbreviated = part.match(/^\d{1,7}$/u);
    if (abbreviated && prefix) expanded.add(`${prefix}${abbreviated[0]}`);
  }

  return expanded;
}

export function canonicalCaseIdentity(value) {
  const members = [...expandProviderCaseNumberSet(value)].filter(Boolean).sort();
  if (members.length > 0) return members.join("|");
  return normalizeProviderCaseText(value);
}

export function canonicalCaseNumber(value) {
  const members = [...expandProviderCaseNumberSet(value)].filter(Boolean).sort();
  return members.length > 0 ? members.join(",") : normalizeProviderCaseText(value);
}

export function caseIdentityMatches(left, right) {
  const leftIdentity = canonicalCaseIdentity(left);
  const rightIdentity = canonicalCaseIdentity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

export function evidenceProgressSnapshot(ledger) {
  const snapshot = typeof ledger?.snapshot === "function" ? ledger.snapshot() : { cases: [], laws: [] };
  const cases = Array.isArray(snapshot.cases) ? snapshot.cases : [];
  return {
    observed: cases.filter((item) => item.discovered).length,
    verified: cases.filter((item) => item.detailVerified).length,
    caseIdentities: cases.filter((item) => item.discovered).map((item) => canonicalCaseIdentity(item.rawCaseNumber || item.caseNumber)).filter(Boolean).sort(),
    verifiedIdentities: cases.filter((item) => item.detailVerified).map((item) => canonicalCaseIdentity(item.rawCaseNumber || item.caseNumber)).filter(Boolean).sort(),
  };
}

export function evidenceProgressSignature(ledgerOrProgress) {
  const progress = ledgerOrProgress?.caseIdentities
    ? ledgerOrProgress
    : evidenceProgressSnapshot(ledgerOrProgress);
  return JSON.stringify({
    caseIdentities: progress.caseIdentities,
    verifiedIdentities: progress.verifiedIdentities,
  });
}

export function hasSubstantiveEvidenceProgress(before, after) {
  return evidenceProgressSignature(before) !== evidenceProgressSignature(after);
}

function caseState(item) {
  const caseNumber = item.rawCaseNumber || item.caseNumber || "";
  return {
    provider_id: item.id || "",
    domain: item.domain || "",
    case_number: caseNumber,
    canonical_case_id: item.canonicalCaseId || item.caseKey || canonicalCaseIdentity(caseNumber),
    observed: Boolean(item.discovered),
    detail_opened: Boolean(item.detailOpened),
    detail_verified: Boolean(item.detailVerified),
    selectable: Boolean(item.detailVerified),
  };
}

export const SELECTION_REPAIR_REASON_CODES = Object.freeze([
  "IDENTITY_NORMALIZATION",
  "UNOBSERVED_SELECTION",
  "UNVERIFIED_SELECTION",
  "DETAIL_REQUIRED",
  "FINAL_SCHEMA_MISMATCH",
  "RANK_ORDER_NORMALIZATION",
  "DUPLICATE_CASE_NORMALIZATION",
  "COMPOUND_CASE_NORMALIZATION",
  "OTHER",
]);

export function selectionRepairReasons({ selection, gated, ledger } = {}) {
  const reasons = new Set();
  const selected = Array.isArray(selection?.selected) ? selection.selected : [];
  const rejected = Array.isArray(gated?.rejectedSelected) ? gated.rejectedSelected : [];
  if (!Array.isArray(selection?.selected) || typeof selection?.intro !== "string") reasons.add("FINAL_SCHEMA_MISMATCH");
  for (const item of rejected) {
    if (item.reason === "CASE_NOT_OBSERVED") reasons.add("UNOBSERVED_SELECTION");
    else if (item.reason === "NOT_DETAIL_VERIFIED") reasons.add("UNVERIFIED_SELECTION");
    else if (item.reason === "DUPLICATE_CASE") reasons.add("DUPLICATE_CASE_NORMALIZATION");
    else reasons.add("FINAL_SCHEMA_MISMATCH");
  }
  if (Array.isArray(gated?.protocolDiagnostics) && gated.protocolDiagnostics.some((item) => item.code === "RESULT_MAX_TRUNCATED")) {
    reasons.add("RANK_ORDER_NORMALIZATION");
  }
  if (selected.some((item) => {
    const requested = text(item?.case_no || item?.caseNumber);
    const candidate = ledger?.getCase?.(requested);
    return candidate && requested !== (candidate.rawCaseNumber || candidate.caseNumber)
      && caseIdentityMatches(requested, candidate.rawCaseNumber || candidate.caseNumber);
  })) reasons.add("IDENTITY_NORMALIZATION");
  if (selected.some((item) => {
    const candidate = ledger?.getCase?.(text(item?.case_no || item?.caseNumber));
    return (candidate?.canonicalMembers || []).length > 1;
  })) reasons.add("COMPOUND_CASE_NORMALIZATION");
  const progress = evidenceProgressSnapshot(ledger);
  if (selected.length === 0 && progress.observed > 0 && progress.verified === 0) reasons.add("DETAIL_REQUIRED");
  if (gated?.selection_repaired && reasons.size === 0) reasons.add("OTHER");
  return [...reasons].filter((reason) => SELECTION_REPAIR_REASON_CODES.includes(reason));
}

export function commonEvidenceState(ledger) {
  const snapshot = typeof ledger?.snapshot === "function" ? ledger.snapshot() : {};
  const cases = Array.isArray(snapshot.cases) ? snapshot.cases : [];
  const observed = cases.filter((item) => item.discovered).map(caseState);
  const verified = cases.filter((item) => item.detailVerified).map(caseState);
  const rejected = (Array.isArray(snapshot.selectionTraces) ? snapshot.selectionTraces : [])
    .flatMap((trace) => Array.isArray(trace.rejected_selection) ? trace.rejected_selection : [])
    .map((item) => ({ ...item }));
  const detailAttempts = Array.isArray(snapshot.detailTraces) ? snapshot.detailTraces.map((item) => ({ ...item })) : [];
  const searchProvenance = Array.isArray(snapshot.searchTraces) ? snapshot.searchTraces.map((item) => ({ ...item })) : [];
  return {
    observed,
    detail_attempts: detailAttempts,
    verified,
    rejected,
    selectable: verified,
    verification_failures: Array.isArray(snapshot.verificationFailures)
      ? snapshot.verificationFailures.map((item) => ({ ...item }))
      : [],
    provenance: {
      provider: text(snapshot.provider || ledger?.provider),
      searches: searchProvenance,
      details: detailAttempts,
    },
  };
}

export function createCommonEvidenceEnvelope({ ledger, resultMax = 5 } = {}) {
  if (!ledger || typeof ledger.snapshot !== "function") throw new Error("COMMON_EVIDENCE_ENVELOPE_LEDGER_REQUIRED");
  const validateSelection = (selection) => {
    const gated = finalizeSelection(selection, ledger, { resultMax });
    return {
      ...gated,
      selection_repair_reasons: selectionRepairReasons({ selection, gated, ledger }),
    };
  };
  return Object.freeze({
    provider: text(ledger.provider) || "unknown",
    ledger,
    snapshot: () => ledger.snapshot(),
    progress: () => evidenceProgressSnapshot(ledger),
    state: () => commonEvidenceState(ledger),
    validateSelection,
    finalizeSelection: validateSelection,
    recordSelectionDiagnostic: (args) => ledger.recordSelectionDiagnostic(args),
  });
}
