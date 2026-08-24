import { createAgenticSearchV2 } from "../aoV2/index.js";
import { getDefaultCodexAccountManager } from "../codexAccount.js";
import { createCodexAppServerSessionFactory } from "../codexAppServerRuntime.js";
import { selectCodexModel } from "../codexModelSelection.js";
import { enrichLawReferences, lawDetailLink, parseStatuteReferences } from "../directLookup.js";
import { config } from "../../config.js";
import { toResultContract } from "./resultContract.js";

export const LUNA_NATIVE_EXECUTION_PIN = Object.freeze({
  adapterId: "luna_native",
  provider: "codex_luna",
  architecture: "AO_V2_NATIVE",
  runtime: "codex_app_server",
  toolTransport: "dynamic_tools",
  model: config.codexModel,
  reasoningEffort: config.codexReasoningEffort,
  persistence: "runtime_scoped",
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

function lawReferenceKey(law) {
  return `${law?.lawName || ""}|${law?.article || ""}|${law?.link || ""}`;
}

function lawReferenceIdentityKey(law) {
  return `${law?.lawName || ""}|${law?.article || ""}`;
}

function renderableLawReference(law) {
  return Boolean(law?.lawName && law?.link);
}

function uniqueLawReferences(references) {
  const seen = new Set();
  return references.filter((law) => {
    if (!renderableLawReference(law)) return false;
    const key = lawReferenceKey(law);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function enrichLunaRelatedLawReferences(items, { gateway, telemetry } = {}) {
  if (!gateway || typeof gateway.execute !== "function") {
    return { items, lawReferences: [] };
  }

  const referencesByItem = new Map();
  const referenceTexts = [];
  for (const item of items) {
    if (item?.status !== "verified") continue;
    const references = parseStatuteReferences(item.detail?.sections?.참조조문 || "");
    referencesByItem.set(item, references);
    if (references.length > 0) referenceTexts.push(references.map((reference) => `${reference.lawName} ${reference.article}`).join(" / "));
  }
  if (referenceTexts.length === 0) {
    return { items: items.map((item) => ({ ...item, lawReferences: [] })), lawReferences: [] };
  }

  let enriched = [];
  try {
    enriched = await enrichLawReferences(
      referenceTexts.join(" / "),
      telemetry,
      (name, args) => gateway.execute(name, args),
    );
  } catch {
    enriched = [];
  }

  const enrichedByKey = new Map(enriched.map((law) => [lawReferenceIdentityKey(law), law]));
  const enrichedItems = items.map((item) => {
    const references = referencesByItem.get(item) || [];
    const itemLawReferences = uniqueLawReferences(references
      .map((reference) => enrichedByKey.get(lawReferenceIdentityKey(reference)))
      .filter(Boolean));
    return { ...item, lawReferences: itemLawReferences };
  });
  return {
    items: enrichedItems,
    lawReferences: uniqueLawReferences(enriched),
  };
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
    return result.items
      .filter((item) => item?.status === "verified")
      .map((item) => ({ ...item, lawReferences: [] }));
  }
  if (!ledger || typeof ledger.getCase !== "function" || !Array.isArray(result.selected)) return [];
  return result.selected.flatMap((selection) => {
    const requestedCaseNumber = selection?.case_no || selection?.caseNumber || "";
    const candidate = ledger.getCase(requestedCaseNumber);
    if (!candidate || !candidate.detailVerified) return [];
    const providerCaseNumber = candidate.rawCaseNumber || candidate.caseNumber;
    return [{
      status: "verified",
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
        rawText: ledger.getDetailText?.(requestedCaseNumber) || candidate.rawText || "",
      },
      lawReferences: [],
      match: selection?.match || "related",
    }];
  });
}

export function createLunaNativeAdapter({
  run,
  accountManager = null,
  createSearch = null,
} = {}) {
  const usesDefaultSearch = typeof createSearch !== "function" && !run;
  const searchFactory = createSearch || ((options) => createAgenticSearchV2({
    ...options,
    provider: "codex_luna",
    adapterOptions: { createSession: createCodexAppServerSessionFactory(), ...(options.adapterOptions || {}) },
  }));
  const persistentSearch = run ? null : searchFactory({ provider: "codex_luna" });
  if (!run && (!persistentSearch || typeof persistentSearch.runWithContext !== "function")) {
    throw new Error("LUNA_NATIVE_SEARCH_FACTORY_INVALID");
  }
  async function selectedModel(options) {
    const manager = accountManager || (usesDefaultSearch ? getDefaultCodexAccountManager() : null);
    if (!manager || typeof manager.read !== "function") return selectCodexModel("unknown");
    try {
      return selectCodexModel((await manager.read())?.planType);
    } catch {
      return selectCodexModel("unknown");
    }
  }
  return {
    id: "luna_native",
    provider: "luna",
    architecture: "AO_V2_NATIVE",
    executionPin: LUNA_NATIVE_EXECUTION_PIN,
    async runNaturalQuery(query, options = {}) {
      const model = await selectedModel(options);
      const runOptions = { ...options, model };
      const context = run
        ? { result: await run(query, { ...runOptions, provider: "codex_luna" }), ledger: null }
        : await persistentSearch.runWithContext(query, runOptions);
      const result = context.result || {};
      const ledger = context.ledger || null;
      const items = buildLunaResultItems(result, ledger);
      const lawEnrichment = context.gateway
        ? await enrichLunaRelatedLawReferences(items, { gateway: context.gateway, telemetry: context.telemetry })
        : { items, lawReferences: buildLunaLawReferences(result) };
      ledger?.recordClaimReferences?.({
        claims: lawEnrichment.lawReferences.map((law) => ({
          claimType: "law",
          normalizedReference: law.article,
          lawName: law.lawName,
          lawId: law.lawId,
          mst: law.mst,
        })),
      });
      const candidateCaseNumbers = ledger?.getObservedCaseNumbers?.() || result.candidateCaseNumbers || [];
      return toResultContract({
        ...result,
        query,
        items: lawEnrichment.items,
        candidateCaseNumbers,
        lawReferences: lawEnrichment.lawReferences,
      }, {
        adapterId: "luna_native",
        provider: "codex_luna",
        architecture: "AO_V2_NATIVE",
        executionPin: LUNA_NATIVE_EXECUTION_PIN,
      });
    },
  };
}
