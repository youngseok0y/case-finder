import { randomUUID } from "node:crypto";
import { normalizeCaseNumber } from "../router.js";
import {
  canonicalCaseIdentity,
  caseIdentityMatches,
  expandProviderCaseNumberSet,
  parseProviderCaseNumber,
} from "./commonEvidenceEnvelope.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePush(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function caseNumberOf(value) {
  return normalizeCaseNumber(text(value?.caseNumber || value?.case_no || value));
}

function rawCaseNumberOf(value) {
  return text(value?.caseNumber || value?.case_no || value);
}

function evidenceCaseKey(value) {
  return canonicalCaseIdentity(value) || normalizeCaseNumber(value);
}

export function providerBoundCaseIdentityCompatibility(observedCase, detailCase) {
  const observed = parseProviderCompoundCaseNumber(observedCase);
  const detail = parseProviderCompoundCaseNumber(detailCase);
  if (observed.ambiguous || detail.ambiguous) return "mismatch";
  if (caseIdentityMatches(observedCase, detailCase)) return "exact";
  const observedMembers = new Set(observed.canonicalMembers);
  const detailMembers = new Set(detail.canonicalMembers);
  if (observedMembers.size === 0 || detailMembers.size === 0) return "mismatch";
  if ([...observedMembers].every((member) => detailMembers.has(member))) return "provider_compound_expansion";
  return "mismatch";
}

function normalizeLawArticle(value) {
  const source = text(value).replace(/\s+/gu, "");
  const match = source.match(/^(?:제)?(\d{1,4})조(?:의(\d{1,2}))?/u);
  if (!match) return "";
  return `제${Number.parseInt(match[1], 10)}조${match[2] ? `의${Number.parseInt(match[2], 10)}` : ""}`;
}

export function parseProviderCompoundCaseNumber(value) {
  const rawCaseNumber = rawCaseNumberOf(value);
  if (!rawCaseNumber) return { rawCaseNumber: "", canonicalMembers: [], acceptedEvidenceKeys: [], ambiguous: true };
  const source = rawCaseNumber.replace(/\([^)]*\)/g, "").trim();
  const direct = parseProviderCaseNumber(source);
  if (direct) {
    return {
      rawCaseNumber,
      canonicalMembers: [direct.caseNumber],
      acceptedEvidenceKeys: [evidenceCaseKey(direct.caseNumber)],
      ambiguous: false,
    };
  }
  const parts = source
    .split(/\s*(?:,|，|;|\/|·|및|등|외)\s*/u)
    .map((part) => part.replace(/^[\[\]()]+|[\[\]()]+$/g, "").trim())
    .filter(Boolean);
  const members = [];
  const unparsed = [];
  let prefix = "";
  for (const part of parts) {
    const full = parseProviderCaseNumber(part);
    if (full) {
      prefix = `${full.year}${full.typeCode}`;
      uniquePush(members, full.caseNumber);
      continue;
    }
    const abbreviated = part.match(/^\d{1,7}$/u);
    if (abbreviated && prefix) {
      uniquePush(members, `${prefix}${abbreviated[0]}`);
      continue;
    }
    unparsed.push(part);
  }
  if (members.length === 0) {
    for (const member of expandProviderCaseNumberSet(source)) uniquePush(members, member);
  }
  const canonicalMembers = [...members].sort();
  const acceptedEvidenceKeys = [...new Set([
    evidenceCaseKey(rawCaseNumber),
    ...canonicalMembers.map((member) => evidenceCaseKey(member)),
  ].filter(Boolean))];
  return {
    rawCaseNumber,
    canonicalMembers,
    acceptedEvidenceKeys,
    ambiguous: canonicalMembers.length === 0 || unparsed.length > 0,
  };
}

function mergeProviderCaseEvidence(candidate, rawCaseNumber) {
  const parsed = parseProviderCompoundCaseNumber(rawCaseNumber);
  if (parsed.ambiguous) return parsed;
  uniquePush(candidate.rawCaseNumbers, parsed.rawCaseNumber);
  candidate.rawCaseNumber ||= parsed.rawCaseNumber;
  for (const member of parsed.canonicalMembers) uniquePush(candidate.canonicalMembers, member);
  for (const key of parsed.acceptedEvidenceKeys) uniquePush(candidate.acceptedEvidenceKeys, key);
  return parsed;
}

let nextScopeId = 1;
const scopeRunId = randomUUID();

export class EvidenceLedger {
  constructor({ provider = "unknown", scopeId = `ao-v2-${scopeRunId}-question-${nextScopeId++}` } = {}) {
    this.provider = provider;
    this.scopeId = scopeId;
    this.cases = new Map();
    this.laws = new Map();
    this.selectionAttempts = [];
    this.verificationFailures = [];
    this.searchTraces = [];
    this.detailTraces = [];
    this.selectionTraces = [];
  }

  recordVerificationFailure(failure = {}) {
    const normalized = {
      code: text(failure.code),
      requestedId: text(failure.requestedId),
      requestedCaseNumber: rawCaseNumberOf(failure.requestedCaseNumber),
      detailCaseNumber: rawCaseNumberOf(failure.detailCaseNumber),
    };
    if (!normalized.code) return;
    const duplicate = this.verificationFailures.some((item) =>
      item.code === normalized.code
      && item.requestedId === normalized.requestedId
      && item.requestedCaseNumber === normalized.requestedCaseNumber
      && item.detailCaseNumber === normalized.detailCaseNumber,
    );
    if (!duplicate) this.verificationFailures.push(normalized);
  }

  recordDecisionSearch({ query, domain, items = [], providerId = "", sourceTool = "search_decisions" } = {}) {
    const normalizedQuery = text(query);
    const returnedCandidates = (Array.isArray(items) ? items : []).map((item) => {
      const rawCaseNumber = rawCaseNumberOf(item);
      const caseNumber = caseNumberOf(item);
      return {
        provider_id: text(item?.id || providerId),
        returned_case_number: rawCaseNumber || caseNumber,
        canonical_case_id: canonicalCaseIdentity(rawCaseNumber || caseNumber),
      };
    }).filter((item) => item.provider_id || item.returned_case_number || item.canonical_case_id);
    this.searchTraces.push({
      source_tool: text(sourceTool) || "search_decisions",
      query: normalizedQuery,
      domain: text(domain),
      returned_candidate_ids: [...new Set(returnedCandidates.map((item) => item.provider_id).filter(Boolean))],
      returned_case_numbers: returnedCandidates.map((item) => item.returned_case_number).filter(Boolean),
      canonicalized_candidate_ids: returnedCandidates.map((item) => item.canonical_case_id).filter(Boolean),
      candidates: returnedCandidates,
    });
    let added = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const rawCaseNumber = rawCaseNumberOf(item);
      const caseNumber = caseNumberOf(item);
      if (!caseNumber) continue;
      const key = canonicalCaseIdentity(rawCaseNumber || caseNumber) || evidenceCaseKey(caseNumber);
      let candidate = this.cases.get(key);
      if (!candidate) {
        candidate = {
          caseKey: key,
          canonicalCaseId: canonicalCaseIdentity(rawCaseNumber || caseNumber),
          caseNumber,
          domain: text(domain),
          rawCaseNumber: "",
          rawCaseNumbers: [],
          canonicalMembers: [],
          acceptedEvidenceKeys: [],
          compoundCaseAmbiguous: false,
          discovered: true,
          firstSearchQuery: normalizedQuery,
          searchQueries: [],
          providerIds: [],
          detailOpened: false,
          detailVerified: false,
          court: "",
          date: "",
          title: "",
          id: "",
          sections: {},
          rawText: "",
          selectedAttempts: [],
        };
        this.cases.set(key, candidate);
        added += 1;
      }
      if (rawCaseNumber) {
        uniquePush(candidate.rawCaseNumbers, rawCaseNumber);
        candidate.rawCaseNumber ||= rawCaseNumber;
      }
      candidate.discovered = true;
      candidate.domain ||= text(domain);
      uniquePush(candidate.searchQueries, normalizedQuery);
      uniquePush(candidate.providerIds, text(item.id || providerId));
      candidate.id ||= text(item.id);
      candidate.title ||= text(item.title);
      candidate.court ||= text(item.court);
      candidate.date ||= text(item.date);
    }
    return { added, observed: items.length || 0 };
  }

  recordDecisionDetail({ domain, id, caseNumber, detail = {}, rawText = "", verified = true } = {}) {
    const requestedId = text(id);
    const rawDetailCaseNumber = rawCaseNumberOf(caseNumber || detail.caseNumber);
    const candidateByProvider = requestedId
      ? [...this.cases.values()].find((item) => item.providerIds.includes(requestedId))
      : null;
    const candidateByIdentity = rawDetailCaseNumber
      ? [...this.cases.values()].find((item) => caseIdentityMatches(item.rawCaseNumber || item.caseNumber, rawDetailCaseNumber))
      : null;
    const candidate = candidateByProvider || candidateByIdentity;
    if (!candidate) {
      this.recordVerificationFailure({
        code: "SEARCH_NOT_OBSERVED",
        requestedId,
        requestedCaseNumber: rawDetailCaseNumber,
        detailCaseNumber: rawDetailCaseNumber,
      });
      this.detailTraces.push({
        domain: text(domain),
        requested_id: requestedId,
        requested_case_number: rawDetailCaseNumber,
        requested_canonical_id: canonicalCaseIdentity(rawDetailCaseNumber),
        returned_case_number: rawDetailCaseNumber,
        returned_canonical_id: canonicalCaseIdentity(rawDetailCaseNumber),
        matched_observed_candidate: null,
        verified: false,
        verification_code: "SEARCH_NOT_OBSERVED",
      });
      return { verified: false, reason: "SEARCH_NOT_OBSERVED" };
    }

    candidate.detailOpened = true;
    candidate.court ||= text(detail.court);
    candidate.date ||= text(detail.date);
    candidate.sections = { ...candidate.sections, ...(detail.sections || {}) };
    const parsed = parseProviderCompoundCaseNumber(rawDetailCaseNumber);
    const identityCompatibility = providerBoundCaseIdentityCompatibility(candidate.rawCaseNumber || candidate.caseNumber, rawDetailCaseNumber);
    const sameProviderProvenance = Boolean(requestedId && candidate.providerIds.includes(requestedId));
    candidate.rawText ||= text(rawText);
    candidate.detailVerified = Boolean(verified && sameProviderProvenance && identityCompatibility !== "mismatch" && text(rawText) && !parsed.ambiguous);
    if (candidate.detailVerified) {
      mergeProviderCaseEvidence(candidate, rawDetailCaseNumber);
    } else {
      const code = !sameProviderProvenance
        ? (requestedId ? "DETAIL_PROVIDER_PROVENANCE_MISMATCH" : "DETAIL_PROVIDER_PROVENANCE_MISSING")
        : identityCompatibility === "mismatch"
          ? "DETAIL_IDENTITY_MISMATCH"
          : !text(rawText)
            ? "DETAIL_TEXT_MISSING"
            : "DETAIL_CASE_NUMBER_AMBIGUOUS";
      const failure = {
        code,
        requestedId,
        requestedCaseNumber: candidate.rawCaseNumber || candidate.caseNumber,
        detailCaseNumber: rawDetailCaseNumber,
      };
      candidate.verificationFailures ||= [];
      const duplicate = candidate.verificationFailures.some((item) =>
        item.code === failure.code
        && item.requestedId === failure.requestedId
        && item.requestedCaseNumber === failure.requestedCaseNumber
        && item.detailCaseNumber === failure.detailCaseNumber,
      );
      if (!duplicate) candidate.verificationFailures.push(failure);
      this.recordVerificationFailure(failure);
    }
    this.detailTraces.push({
      domain: text(domain),
      requested_id: requestedId,
      requested_case_number: candidate.rawCaseNumber || candidate.caseNumber,
      requested_canonical_id: canonicalCaseIdentity(candidate.rawCaseNumber || candidate.caseNumber),
      returned_case_number: rawDetailCaseNumber,
      returned_canonical_id: canonicalCaseIdentity(rawDetailCaseNumber),
      matched_observed_candidate: candidate.canonicalCaseId || candidate.caseKey,
      detail_provider_id: requestedId,
      matched_provider_id: candidate.id || "",
      same_provider_provenance: sameProviderProvenance,
      identity_compatibility: identityCompatibility,
      verified: candidate.detailVerified,
      verification_code: candidate.detailVerified ? "" : candidate.verificationFailures?.at(-1)?.code || "DETAIL_NOT_VERIFIED",
    });
    return {
      verified: candidate.detailVerified,
      reason: candidate.detailVerified ? "" : "DETAIL_NOT_VERIFIED",
      caseNumber: candidate.caseNumber,
    };
  }

  recordLawSearch({ query, items = [] } = {}) {
    let added = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const lawId = text(item.lawId);
      const mst = text(item.mst);
      const title = text(item.title || item.lawName);
      const key = lawId ? `law:${lawId}` : mst ? `mst:${mst}` : title ? `title:${title}` : "";
      if (!key) continue;
      let law = this.laws.get(key);
      if (!law) {
        law = {
          lawKey: key,
          title,
          lawId,
          mst,
          observed: true,
          searchQueries: [],
          textOpened: false,
          openedArticles: [],
        };
        this.laws.set(key, law);
        added += 1;
      }
      uniquePush(law.searchQueries, text(query));
      law.observed = true;
    }
    return { added, observed: items.length || 0 };
  }

  recordLawText({ mst = "", lawId = "", jo = "", textOpened = true } = {}) {
    const targetMst = text(mst);
    const targetLawId = text(lawId);
    const law = [...this.laws.values()].find((item) =>
      (targetMst && item.mst === targetMst) || (targetLawId && item.lawId === targetLawId));
    if (!law) return { verified: false, reason: "LAW_NOT_OBSERVED" };
    law.textOpened = Boolean(textOpened);
    const article = normalizeLawArticle(jo);
    if (law.textOpened && article) uniquePush(law.openedArticles, article);
    return { verified: law.textOpened, reason: law.textOpened ? "" : "LAW_TEXT_NOT_OPENED" };
  }

  isLawArticleOpened({ mst = "", lawId = "", jo = "", article = "" } = {}) {
    const targetMst = text(mst);
    const targetLawId = text(lawId);
    const targetArticle = normalizeLawArticle(jo || article);
    if (!targetArticle) return false;
    return [...this.laws.values()].some((item) =>
      ((!targetMst && !targetLawId) || (targetMst && item.mst === targetMst) || (targetLawId && item.lawId === targetLawId))
      && (item.openedArticles || []).includes(targetArticle),
    );
  }

  isDecisionIdObserved(domain, id) {
    const value = text(id);
    return [...this.cases.values()].some((item) => item.domain === text(domain) && item.providerIds.includes(value));
  }

  isLawObserved({ mst = "", lawId = "" } = {}) {
    const targetMst = text(mst);
    const targetLawId = text(lawId);
    return [...this.laws.values()].some((item) =>
      (targetMst && item.mst === targetMst) || (targetLawId && item.lawId === targetLawId));
  }

  getCase(caseNumber) {
    const normalized = caseNumberOf(caseNumber);
    if (!normalized) return null;
    const direct = this.cases.get(canonicalCaseIdentity(caseNumber) || evidenceCaseKey(normalized));
    if (direct) return direct;
    const requestedMembers = [...expandProviderCaseNumberSet(normalized)];
    const requestedKey = evidenceCaseKey(normalized);
    return [...this.cases.values()].find((candidate) =>
      candidate.acceptedEvidenceKeys.includes(requestedKey)
      || (requestedMembers.length > 0 && requestedMembers.every((member) => candidate.canonicalMembers.includes(member))),
    ) || null;
  }

  getObservedCaseNumbers() {
    return [...this.cases.values()].filter((item) => item.discovered).map((item) => item.caseNumber);
  }

  getVerifiedCases() {
    return [...this.cases.values()].filter((item) => item.detailVerified);
  }

  isFinalEligible(caseNumber) {
    return Boolean(this.getCase(caseNumber)?.detailVerified);
  }

  recordSelectionAttempt(selection) {
    const selected = Array.isArray(selection?.selected) ? selection.selected : [];
    const attempt = selected.map((item) => ({
      case_no: text(item?.case_no || item?.caseNumber),
      match: text(item?.match),
    }));
    this.selectionAttempts.push(attempt);
    for (const item of attempt) {
      const candidate = this.getCase(item.case_no);
      if (candidate) candidate.selectedAttempts.push({ match: item.match });
    }
    return attempt;
  }

  recordDecisionDetailAttempt({ domain, id, caseNumber = "", reason = "DETAIL_PROVIDER_ERROR", providerError = false } = {}) {
    const requestedCaseNumber = rawCaseNumberOf(caseNumber);
    this.detailTraces.push({
      domain: text(domain),
      requested_id: text(id),
      requested_case_number: requestedCaseNumber,
      requested_canonical_id: canonicalCaseIdentity(requestedCaseNumber),
      returned_case_number: "",
      returned_canonical_id: "",
      matched_observed_candidate: null,
      verified: false,
      verification_code: text(reason) || "DETAIL_PROVIDER_ERROR",
      provider_error: Boolean(providerError),
    });
  }

  recordSelectionDiagnostic({ selection, gated, continuationCount = 0 } = {}) {
    const normalizeSelection = (items) => (Array.isArray(items) ? items : []).map((item) => {
      const caseNumber = text(item?.case_no || item?.caseNumber);
      return {
        case_number: caseNumber,
        canonical_case_id: canonicalCaseIdentity(caseNumber),
        match: text(item?.match),
      };
    }).filter((item) => item.case_number);
    const cases = [...this.cases.values()];
    this.selectionTraces.push({
      attempt: this.selectionTraces.length + 1,
      continuation_count: Number(continuationCount || 0),
      terra_selected: normalizeSelection(selection?.selected),
      accepted_verified_selection: normalizeSelection(gated?.selected),
      rejected_selection: Array.isArray(gated?.rejectedSelected) ? gated.rejectedSelected.map((item) => ({ ...item })) : [],
      observed_candidate_ids: cases.filter((item) => item.discovered).map((item) => ({
        provider_id: item.id || "",
        case_number: item.rawCaseNumber || item.caseNumber,
        canonical_case_id: item.canonicalCaseId || item.caseKey,
      })),
      verified_candidate_ids: cases.filter((item) => item.detailVerified).map((item) => ({
        provider_id: item.id || "",
        case_number: item.rawCaseNumber || item.caseNumber,
        canonical_case_id: item.canonicalCaseId || item.caseKey,
      })),
    });
  }

  snapshot() {
    return {
      provider: this.provider,
      scopeId: this.scopeId,
      cases: [...this.cases.values()].map((item) => ({
        ...item,
        rawCaseNumbers: [...item.rawCaseNumbers],
        canonicalMembers: [...item.canonicalMembers],
        acceptedEvidenceKeys: [...item.acceptedEvidenceKeys],
        searchQueries: [...item.searchQueries],
        providerIds: [...item.providerIds],
        sections: { ...item.sections },
        selectedAttempts: item.selectedAttempts.map((attempt) => ({ ...attempt })),
        verificationFailures: (item.verificationFailures || []).map((failure) => ({ ...failure })),
      })),
      laws: [...this.laws.values()].map((item) => ({
        ...item,
        searchQueries: [...item.searchQueries],
        openedArticles: [...(item.openedArticles || [])],
      })),
      selectionAttempts: this.selectionAttempts.map((attempt) => attempt.map((item) => ({ ...item }))),
      verificationFailures: this.verificationFailures.map((failure) => ({ ...failure })),
      searchTraces: this.searchTraces.map((trace) => ({
        ...trace,
        returned_candidate_ids: [...trace.returned_candidate_ids],
        returned_case_numbers: [...trace.returned_case_numbers],
        canonicalized_candidate_ids: [...trace.canonicalized_candidate_ids],
        candidates: trace.candidates.map((item) => ({ ...item })),
      })),
      detailTraces: this.detailTraces.map((trace) => ({ ...trace })),
      selectionTraces: this.selectionTraces.map((trace) => ({
        ...trace,
        terra_selected: trace.terra_selected.map((item) => ({ ...item })),
        accepted_verified_selection: trace.accepted_verified_selection.map((item) => ({ ...item })),
        rejected_selection: trace.rejected_selection.map((item) => ({ ...item })),
        observed_candidate_ids: trace.observed_candidate_ids.map((item) => ({ ...item })),
        verified_candidate_ids: trace.verified_candidate_ids.map((item) => ({ ...item })),
      })),
    };
  }
}

export function createEvidenceLedger(options) {
  return new EvidenceLedger(options);
}
