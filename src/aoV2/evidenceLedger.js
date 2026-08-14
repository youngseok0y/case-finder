import { randomUUID } from "node:crypto";
import { caseNumberKey, caseNumberMatches, expandCaseNumberSet, normalizeCaseNumber, parseCaseNumber } from "../router.js";

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

export function parseProviderCompoundCaseNumber(value) {
  const rawCaseNumber = rawCaseNumberOf(value);
  if (!rawCaseNumber) return { rawCaseNumber: "", canonicalMembers: [], acceptedEvidenceKeys: [], ambiguous: true };
  const source = rawCaseNumber.replace(/\([^)]*\)/g, "").trim();
  const parts = source
    .split(/\s*(?:,|，|;|\/|·|및|등|외)\s*/u)
    .map((part) => part.replace(/^[\[\]()]+|[\[\]()]+$/g, "").trim())
    .filter(Boolean);
  const members = [];
  const unparsed = [];
  let prefix = "";
  for (const part of parts) {
    const full = parseCaseNumber(part);
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
    for (const member of expandCaseNumberSet(source)) uniquePush(members, member);
  }
  const canonicalMembers = [...members].sort();
  const acceptedEvidenceKeys = [...new Set([
    caseNumberKey(rawCaseNumber),
    ...canonicalMembers.map((member) => caseNumberKey(member)),
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
  }

  recordDecisionSearch({ query, domain, items = [], providerId = "" } = {}) {
    const normalizedQuery = text(query);
    let added = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const rawCaseNumber = rawCaseNumberOf(item);
      const caseNumber = caseNumberOf(item);
      if (!caseNumber) continue;
      const key = caseNumberKey(caseNumber);
      let candidate = this.cases.get(key);
      if (!candidate) {
        candidate = {
          caseKey: key,
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
    const normalizedCaseNumber = caseNumberOf(caseNumber || detail.caseNumber);
    const candidate = [...this.cases.values()].find((item) =>
      (requestedId && item.providerIds.includes(requestedId))
      || (normalizedCaseNumber && caseNumberMatches(item.caseNumber, normalizedCaseNumber)));
    if (!candidate) return { verified: false, reason: "SEARCH_NOT_OBSERVED" };

    candidate.detailOpened = true;
    candidate.court ||= text(detail.court);
    candidate.date ||= text(detail.date);
    candidate.sections = { ...candidate.sections, ...(detail.sections || {}) };
    const parsed = parseProviderCompoundCaseNumber(rawDetailCaseNumber);
    const exactCase = normalizedCaseNumber && caseNumberMatches(candidate.caseNumber, normalizedCaseNumber);
    candidate.detailVerified = Boolean(verified && exactCase && text(rawText) && !parsed.ambiguous);
    if (candidate.detailVerified) {
      mergeProviderCaseEvidence(candidate, rawDetailCaseNumber);
    }
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
        };
        this.laws.set(key, law);
        added += 1;
      }
      uniquePush(law.searchQueries, text(query));
      law.observed = true;
    }
    return { added, observed: items.length || 0 };
  }

  recordLawText({ mst = "", lawId = "", textOpened = true } = {}) {
    const targetMst = text(mst);
    const targetLawId = text(lawId);
    const law = [...this.laws.values()].find((item) =>
      (targetMst && item.mst === targetMst) || (targetLawId && item.lawId === targetLawId));
    if (!law) return { verified: false, reason: "LAW_NOT_OBSERVED" };
    law.textOpened = Boolean(textOpened);
    return { verified: law.textOpened, reason: law.textOpened ? "" : "LAW_TEXT_NOT_OPENED" };
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
    const direct = this.cases.get(caseNumberKey(normalized));
    if (direct) return direct;
    const requestedMembers = [...expandCaseNumberSet(normalized)];
    const requestedKey = caseNumberKey(normalized);
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
      })),
      laws: [...this.laws.values()].map((item) => ({ ...item, searchQueries: [...item.searchQueries] })),
      selectionAttempts: this.selectionAttempts.map((attempt) => attempt.map((item) => ({ ...item }))),
    };
  }
}

export function createEvidenceLedger(options) {
  return new EvidenceLedger(options);
}
