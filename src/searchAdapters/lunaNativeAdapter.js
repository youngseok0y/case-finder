import { createAgenticSearchV2 } from "../aoV2/index.js";
import { createCodexCliSessionFactory } from "../codexNativeSession.js";
import { lawDetailLink } from "../directLookup.js";
import { config } from "../../config.js";
import { toResultContract } from "./resultContract.js";

export const LUNA_NATIVE_EXECUTION_PIN = Object.freeze({
  adapterId: "luna_native",
  provider: "codex_luna",
  architecture: "AO_V2_NATIVE",
  runtime: "codex_cli",
  model: config.codexModel,
  reasoningEffort: config.codexReasoningEffort,
  persistence: "adapter_scoped",
});

function buildLunaLawReferences(result) {
  const references = Array.isArray(result.lawReferences) ? result.lawReferences : [];
  const seen = new Set();
  return references.filter((law) => {
    if (!law || typeof law !== "object") return false;
    const link = law.link || lawDetailLink(law.mst);
    const key = `${law.lawName || ""}|${law.article || ""}|${link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(law.lawName || link);
  }).map((law) => ({ ...law, link: law.link || lawDetailLink(law.mst) }));
}

function nativeDecisionLink(domain, providerId) {
  const id = String(providerId || "");
  if (!/^\d+$/u.test(id)) return "";
  if (domain === "precedent") return `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(id)}`;
  if (domain === "constitutional") return `https://www.law.go.kr/LSW/detcInfoP.do?detcSeq=${encodeURIComponent(id)}`;
  if (domain === "admin_appeal") {
    return `https://www.law.go.kr/DRF/lawService.do?target=decc&ID=${encodeURIComponent(id)}&type=JSON&mobileYn=`;
  }
  return "";
}

export function buildLunaResultItems(result = {}, ledger = null) {
  if (Array.isArray(result.items) && result.items.length > 0) {
    return result.items.map((item) => ({ ...item, lawReferences: [] }));
  }
  if (!ledger || typeof ledger.getCase !== "function" || !Array.isArray(result.selected)) return [];
  return result.selected.map((selection) => {
    const requestedCaseNumber = selection?.case_no || selection?.caseNumber || "";
    const candidate = ledger.getCase(requestedCaseNumber);
    if (!candidate) {
      return {
        status: "validation_failed",
        providerId: "",
        caseNumber: String(requestedCaseNumber),
        providerCaseNumber: String(requestedCaseNumber),
        candidateCaseNumbers: [String(requestedCaseNumber)],
        link: "",
        match: selection?.match || "related",
      };
    }
    const providerCaseNumber = candidate.rawCaseNumber || candidate.caseNumber;
    return {
      status: candidate.detailVerified ? "verified" : "validation_failed",
      providerId: candidate.id || "",
      caseNumber: candidate.caseNumber,
      providerCaseNumber,
      candidateCaseNumbers: candidate.canonicalMembers?.length
        ? [...candidate.canonicalMembers]
        : [candidate.caseNumber],
      title: candidate.title || "",
      court: candidate.court || "",
      date: candidate.date || "",
      type: candidate.type || "",
      link: nativeDecisionLink(candidate.domain, candidate.id),
      detail: {
        caseNumber: providerCaseNumber,
        court: candidate.court || "",
        date: candidate.date || "",
        sections: candidate.sections || {},
      },
      lawReferences: [],
      match: selection?.match || "related",
    };
  });
}

export function createLunaNativeAdapter({
  run,
  createSearch = (options) => createAgenticSearchV2({
    ...options,
    provider: "codex_luna",
    adapterOptions: { createSession: createCodexCliSessionFactory(), ...(options.adapterOptions || {}) },
  }),
} = {}) {
  const persistentSearch = run ? null : createSearch({ provider: "codex_luna" });
  if (!run && (!persistentSearch || typeof persistentSearch.runWithContext !== "function")) {
    throw new Error("LUNA_NATIVE_SEARCH_FACTORY_INVALID");
  }
  return {
    id: "luna_native",
    provider: "luna",
    architecture: "AO_V2_NATIVE",
    executionPin: LUNA_NATIVE_EXECUTION_PIN,
    async runNaturalQuery(query, options = {}) {
      const context = run
        ? { result: await run(query, { ...options, provider: "codex_luna" }), ledger: null }
        : await persistentSearch.runWithContext(query, options);
      const result = context.result || {};
      const ledger = context.ledger || null;
      const items = buildLunaResultItems(result, ledger);
      const candidateCaseNumbers = ledger?.getObservedCaseNumbers?.() || result.candidateCaseNumbers || [];
      return toResultContract({ ...result, query, items, candidateCaseNumbers, lawReferences: buildLunaLawReferences(result) }, {
        adapterId: "luna_native",
        provider: "codex_luna",
        architecture: "AO_V2_NATIVE",
        executionPin: LUNA_NATIVE_EXECUTION_PIN,
      });
    },
  };
}
