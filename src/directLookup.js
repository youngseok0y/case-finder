import { config } from "../config.js";
import { callTool } from "./mcpClient.js";
import { classifyLegalResult, LEGAL_RESULT_CATEGORIES } from "./legalResultClassifier.js";
import { dedupeLawReferences, lawReferenceIdentityKey, normalizeLawArticle, normalizeLawName } from "./lawReferences.js";
import { caseNumberIncludes, normalizeCaseNumber } from "./router.js";
import { text } from "./text.js";
import {
  cleanText,
  decodeBasicHtml,
  parseDecisionDetail,
  parseDecisionSearchResults,
  parseLawArticleIdentity,
  parseLawSearchResults,
  toolText,
} from "./legalMcpParser.js";

const ARTICLE_PATTERN = /(?:제)?\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?/g;
const LAW_NAME_PATTERN = /([「『]?[가-힣][가-힣0-9·()「」『』ㆍ\s]{0,79}(?:시행규칙|시행령|법률|헌법|규칙|법)[」』]?)\s*$/u;

export { parseDecisionDetail, parseDecisionSearchResults, parseLawSearchResults, toolText } from "./legalMcpParser.js";

export function recordMcpCall(telemetry, name) {
  if (!telemetry) return;
  telemetry.mcpCallsTotal = (telemetry.mcpCallsTotal || 0) + 1;
  if (name === "search_decisions" || name === "search_law") telemetry.mcpSearchCalls = (telemetry.mcpSearchCalls || 0) + 1;
  if (name === "get_decision_text" || name === "get_law_text") telemetry.mcpDetailCalls = (telemetry.mcpDetailCalls || 0) + 1;
}

function abortedError() {
  const error = new Error("MCP 호출이 취소되었습니다.");
  error.code = "ABORTED";
  return error;
}

export async function trackedCallTool(name, args, telemetry = null, options = {}) {
  if (options.signal?.aborted) throw abortedError();
  recordMcpCall(telemetry, name);
  const executeTool = typeof telemetry?.executeTool === "function"
    ? telemetry.executeTool
    : callTool;
  return executeTool(name, args, options);
}

export function sanitizeApiLink(rawLink, fallbackId = "") {
  if (!rawLink) return "";
  try {
    const decoded = decodeBasicHtml(rawLink);
    const link = new URL(decoded, "https://www.law.go.kr");
    if (!["http:", "https:"].includes(link.protocol)) return "";
    if (!/(^|\.)law\.go\.kr$/i.test(link.hostname)) return "";
    if (link.pathname.toLowerCase() === "/drf/lawservice.do" && link.searchParams.get("target") === "prec") {
      const id = link.searchParams.get("ID") || fallbackId;
      if (id) return `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${encodeURIComponent(id)}`;
    }
    if (link.pathname.toLowerCase() === "/drf/lawservice.do" && link.searchParams.get("target") === "detc") {
      const id = link.searchParams.get("ID") || fallbackId;
      if (id) return `https://www.law.go.kr/LSW/detcInfoP.do?detcSeq=${encodeURIComponent(id)}`;
    }
    if (link.pathname.toLowerCase() === "/drf/lawservice.do" && link.searchParams.get("target") === "decc") {
      const id = link.searchParams.get("ID") || fallbackId;
      if (id) return `https://www.law.go.kr/LSW/deccInfoP.do?deccSeq=${encodeURIComponent(id)}`;
    }
    if (link.pathname.toLowerCase() === "/drf/lawservice.do" && link.searchParams.get("target") === "law") {
      const mst = link.searchParams.get("MST") || fallbackId;
      if (/^\d+$/.test(mst)) return `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${encodeURIComponent(mst)}`;
    }
    link.searchParams.delete("OC");
    return link.toString();
  } catch {
    return "";
  }
}

export function decisionDetailLink(domain, providerId) {
  const id = String(providerId || "");
  if (!/^\d+$/.test(id)) return "";
  const links = {
    precedent: ["precInfoP.do", "precSeq"],
    constitutional: ["detcInfoP.do", "detcSeq"],
    admin_appeal: ["deccInfoP.do", "deccSeq"],
  };
  const [path, parameter] = links[domain] || [];
  return path && parameter
    ? `https://www.law.go.kr/LSW/${path}?${parameter}=${encodeURIComponent(id)}`
    : "";
}

export function articleToJoNo(article) {
  const match = String(article || "").trim().match(/^(?:제)?(\d{1,4})조(?:의(\d{1,2}))?/u);
  if (!match) return "";
  const articleNumber = Number.parseInt(match[1], 10);
  const branchNumber = match[2] ? Number.parseInt(match[2], 10) : 0;
  if (!Number.isInteger(articleNumber) || articleNumber < 1 || articleNumber > 9_999) return "";
  if (!Number.isInteger(branchNumber) || branchNumber < 0 || branchNumber > 99) return "";
  return `${String(articleNumber).padStart(4, "0")}${String(branchNumber).padStart(2, "0")}`;
}

export function lawDetailLink(mst, article = "") {
  if (!/^\d+$/.test(String(mst || ""))) return "";
  const link = new URL("https://www.law.go.kr/LSW/lsInfoP.do");
  link.searchParams.set("lsiSeq", String(mst));
  const joNo = articleToJoNo(article);
  if (joNo) {
    link.searchParams.set("docType", "JO");
    link.searchParams.set("joNo", joNo);
  }
  return link.toString();
}

function lawSearchItems(result) {
  if (Array.isArray(result?.items)) return result.items;
  return parseLawSearchResults(result?.rawText || toolText(result));
}

function lawResultText(result) {
  return cleanText(result?.rawText || toolText(result));
}

function rawToolText(result) {
  return typeof result?.rawText === "string" && result.rawText ? result.rawText : toolText(result);
}

function cleanLawArticleText(rawText) {
  const text = cleanText(rawText);
  const articleStart = text.search(/(?:^|\n)\s*제\d+조(?:의\d+)?/);
  if (articleStart >= 0) return text.slice(articleStart).trim();
  return text
    .replace(/^법령명\s*:\s*.*$/gm, "")
    .replace(/^공포일\s*:\s*.*$/gm, "")
    .replace(/^시행일\s*:\s*.*$/gm, "")
    .replace(/^ℹ️ 조회기준일.*$/gm, "")
    .trim();
}

export function parseStatuteReferences(referenceText) {
  const references = [];
  const seen = new Set();
  let currentLaw = "";
  for (const clause of cleanText(referenceText).split(/\s*[,;\/\n]+\s*/u)) {
    const articleIndex = clause.search(/(?:제)?\d+조/);
    if (articleIndex < 0) continue;
    const lawMatch = clause.slice(0, articleIndex).match(LAW_NAME_PATTERN);
    if (lawMatch?.[1]) currentLaw = lawMatch[1]
      .replace(/^\[\d+\]\s*/, "")
      .replace(/^[「『]|[」』]$/gu, "")
      .trim();
    const lawName = currentLaw;
    if (!lawName) continue;
    for (const articleMatch of clause.slice(articleIndex).matchAll(ARTICLE_PATTERN)) {
      const article = articleMatch[0].startsWith("제") ? articleMatch[0] : `제${articleMatch[0]}`;
      const key = `${lawName}|${article}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push({ lawName, article });
    }
  }
  return references;
}

function lawSearchCacheKey(lawName) {
  return `law-search:${lawReferenceIdentityKey({ lawName, article: "" })}`;
}

function lawDetailCacheKey(candidate, article) {
  const identity = candidate?.lawId ? `lawId:${candidate.lawId}` : `mst:${candidate?.mst || ""}`;
  return `law-detail:${identity}:${article}`;
}

export async function findLawCandidate(lawName, execute, cache = new Map()) {
  const key = lawSearchCacheKey(lawName);
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const searchResult = await execute("search_law", {
      query: lawName,
      display: 5,
    });
    const candidates = lawSearchItems(searchResult);
    const searchCategory = classifyLegalResult(searchResult, {
      toolName: "search_law",
      rawText: rawToolText(searchResult),
      parsedItems: candidates.length > 0,
    });
    if (searchCategory !== LEGAL_RESULT_CATEGORIES.SUCCESS) return null;
    const target = normalizeLawName(lawName);
    const candidate = candidates.find((item) => normalizeLawName(item.title) === target);
    return candidate?.mst || candidate?.lawId ? candidate : null;
  })();
  cache.set(key, promise);
  return promise;
}

export async function enrichLawReferences(referenceText, telemetry = null, executeTool = null, options = {}) {
  const references = parseStatuteReferences(referenceText).slice(0, config.lawMax);
  const cache = options.lawReferenceCache instanceof Map ? options.lawReferenceCache : new Map();
  const execute = typeof executeTool === "function"
    ? executeTool
    : (name, args) => trackedCallTool(name, args, telemetry, options);
  const resolveReference = (reference) => {
    const key = lawReferenceIdentityKey(reference);
    if (cache.has(key)) return cache.get(key);
    const promise = (async () => {
      try {
        if (options.signal?.aborted) throw abortedError();
        const candidate = await findLawCandidate(reference.lawName, execute, cache);
        if (!candidate) return null;
        if (options.signal?.aborted) throw abortedError();
        const detailKey = lawDetailCacheKey(candidate, reference.article);
        let detailPromise = cache.get(detailKey);
        if (!detailPromise) {
          detailPromise = (async () => {
            const lawResult = await execute("get_law_text", {
              ...(candidate.lawId ? { lawId: candidate.lawId } : { mst: candidate.mst }),
              jo: reference.article,
            });
            const rawLawText = lawResultText(lawResult);
            const lawText = cleanLawArticleText(rawLawText);
            const lawArticle = parseLawArticleIdentity(rawLawText);
            const requestedArticle = normalizeLawArticle(reference.article);
            const lawCategory = classifyLegalResult(lawResult, {
              toolName: "get_law_text",
              rawText: rawToolText(lawResult),
            });
            const articleMatches = lawArticle.identifiable && lawArticle.article === requestedArticle;
            return lawCategory === LEGAL_RESULT_CATEGORIES.SUCCESS && lawText && articleMatches ? { lawText } : null;
          })();
          cache.set(detailKey, detailPromise);
        }
        const detail = await detailPromise;
        if (!detail) return null;
        return {
          ...reference,
          text: detail.lawText,
          link: lawDetailLink(candidate.mst, reference.article) || sanitizeApiLink(candidate.link, candidate.mst),
        };
      } catch (error) {
        if (options.signal?.aborted || error?.code === "ABORTED" || error?.name === "AbortError") throw error;
        return null;
      }
    })();
    cache.set(key, promise);
    return promise;
  };

  const enriched = [];
  for (let index = 0; index < references.length; index += 2) {
    const batch = references.slice(index, index + 2);
    enriched.push(...await Promise.all(batch.map(resolveReference)));
  }
  return dedupeLawReferences(enriched.filter(Boolean));
}

export async function lookupDecisionCandidate(candidate, domain = "precedent", prefetched = null, telemetry = null, options = {}) {
  const detailResult = prefetched?.result || await trackedCallTool("get_decision_text", {
    domain,
    id: candidate.id,
    full: false,
  }, telemetry, options);
  const detailText = prefetched?.text || rawToolText(detailResult);
  const detail = prefetched?.detail || parseDecisionDetail(detailText);
  const detailCategory = classifyLegalResult(detailResult, {
    toolName: "get_decision_text",
    rawText: detailText,
  });
  const detailValid = detailCategory === LEGAL_RESULT_CATEGORIES.SUCCESS
    && caseNumberIncludes(detail.caseNumber, candidate.caseNumber);

  return {
    status: detailValid ? "verified" : "validation_failed",
    providerId: String(candidate.id || ""),
    caseNumber: normalizeCaseNumber(candidate.caseNumber),
    candidateCaseNumbers: candidate.candidateCaseNumbers || [candidate.caseNumber],
    title: candidate.title,
    court: detail.court || candidate.court,
    date: detail.date || candidate.date,
    caseType: detail.caseType || candidate.caseType,
    type: detail.type || candidate.type,
    link: sanitizeApiLink(candidate.link, candidate.id) || decisionDetailLink(domain, candidate.id),
    detail,
    lawReferences: detailValid ? await enrichLawReferences(detail.sections.참조조문 || "", telemetry, null, options) : [],
  };
}

async function lookupOne(caseRequest, callOptions = {}) {
  const searchOptions = { caseNumber: caseRequest.caseNumber };
  if (caseRequest.domain === "precedent") searchOptions.search = 2;
  const searchResult = await callTool("search_decisions", {
    domain: caseRequest.domain,
    options: searchOptions,
    display: 100,
  }, callOptions);
  const searchText = rawToolText(searchResult);
  const candidates = parseDecisionSearchResults(searchText);
  const searchCategory = classifyLegalResult(searchResult, {
    toolName: "search_decisions",
    rawText: searchText,
    parsedItems: candidates.length > 0,
  });
  const candidate = candidates.find(
    (item) => caseNumberIncludes(item.caseNumber, caseRequest.caseNumber),
  );
  if (searchCategory === LEGAL_RESULT_CATEGORIES.NOT_FOUND) {
    return {
      status: "not_found",
      caseNumber: caseRequest.caseNumber,
      candidates: candidates.map((item) => item.caseNumber).filter(Boolean),
    };
  }

  // An upstream/API error is not evidence that the requested case does not
  // exist. Keep the result in the verification-failure path so the product
  // does not show a false direct-miss message.
  if (searchCategory !== LEGAL_RESULT_CATEGORIES.SUCCESS || !candidate) {
    return {
      status: "search_failed",
      caseNumber: caseRequest.caseNumber,
      candidates: candidates.map((item) => item.caseNumber).filter(Boolean),
    };
  }

  return lookupDecisionCandidate(
    {
      ...candidate,
      candidateCaseNumbers: candidates.map((item) => item.caseNumber).filter(Boolean),
    },
    caseRequest.domain,
    null,
    null,
    callOptions,
  );
}

export async function lookupDirect(query, route, { abortSignal = null } = {}) {
  const options = { signal: abortSignal, lawReferenceCache: new Map() };
  const items = [];
  for (const caseRequest of route.cases) {
    items.push(await lookupOne(caseRequest, options));
  }
  return {
    route: "direct",
    query,
    requestedCaseNumbers: route.cases.map((item) => item.caseNumber),
    items,
  };
}
