import { config } from "../config.js";
import { callTool } from "./mcpClient.js";
import { caseNumberIncludes, normalizeCaseNumber } from "./router.js";
import {
  cleanText,
  decodeBasicHtml,
  parseDecisionDetail,
  parseDecisionSearchResults,
  parseLawSearchResults,
  toolText,
} from "./legalMcpParser.js";

const ARTICLE_PATTERN = /(?:제)?\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?/g;
const LAW_NAME_PATTERN = /([가-힣][가-힣0-9·()「」ㆍ\s]{0,79}(?:시행규칙|시행령|법률|헌법|규칙|법))\s*$/u;

export { parseDecisionDetail, parseDecisionSearchResults, parseLawSearchResults, toolText } from "./legalMcpParser.js";

export function recordMcpCall(telemetry, name) {
  if (!telemetry) return;
  telemetry.mcpCallsTotal = (telemetry.mcpCallsTotal || 0) + 1;
  if (name === "search_decisions" || name === "search_law") telemetry.mcpSearchCalls = (telemetry.mcpSearchCalls || 0) + 1;
  if (name === "get_decision_text" || name === "get_law_text") telemetry.mcpDetailCalls = (telemetry.mcpDetailCalls || 0) + 1;
}

export async function trackedCallTool(name, args, telemetry = null, options = {}) {
  recordMcpCall(telemetry, name);
  return callTool(name, args, options);
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
  const path = domain === "precedent" ? "precInfoP.do" : "detcInfoP.do";
  const parameter = domain === "precedent" ? "precSeq" : "detcSeq";
  return `https://www.law.go.kr/LSW/${path}?${parameter}=${encodeURIComponent(id)}`;
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
  return parseLawSearchResults(toolText(result));
}

function lawResultText(result) {
  return cleanText(result?.rawText || toolText(result));
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
    if (lawMatch?.[1]) currentLaw = lawMatch[1].replace(/^\[\d+\]\s*/, "").trim();
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

export async function enrichLawReferences(referenceText, telemetry = null, executeTool = null, options = {}) {
  const references = parseStatuteReferences(referenceText).slice(0, config.lawMax);
  const enriched = [];
  const execute = typeof executeTool === "function"
    ? executeTool
    : (name, args) => trackedCallTool(name, args, telemetry, options);
  for (const reference of references) {
    try {
      const searchResult = await execute("search_law", {
        query: reference.lawName,
        display: 5,
      });
      const candidates = lawSearchItems(searchResult);
      const candidateNames = [reference.lawName];
      if (reference.lawName === "헌법") candidateNames.push("대한민국헌법");
      const candidate = candidates.find((item) => candidateNames.some((name) => normalizeCaseNumber(item.title) === normalizeCaseNumber(name)));
      if (!candidate?.mst) continue;
      const lawResult = await execute("get_law_text", {
        mst: candidate.mst,
        jo: reference.article,
      });
      const rawLawText = lawResultText(lawResult);
      const lawText = cleanLawArticleText(rawLawText);
      if (lawResult?.isError || !lawText || rawLawText.includes("[NOT_FOUND]")) {
        continue;
      }
      enriched.push({
        ...reference,
        text: lawText,
        link: lawDetailLink(candidate.mst, reference.article) || sanitizeApiLink(candidate.link, candidate.mst),
      });
    } catch {
      continue;
    }
  }
  return enriched;
}

export async function lookupDecisionCandidate(candidate, domain = "precedent", prefetched = null, telemetry = null, options = {}) {
  const detailResult = prefetched?.result || await trackedCallTool("get_decision_text", {
    domain,
    id: candidate.id,
    full: false,
  }, telemetry, options);
  const detailText = prefetched?.text || toolText(detailResult);
  const detail = prefetched?.detail || parseDecisionDetail(detailText);
  const detailValid = !detailResult?.isError
    && !detailText.includes("[NOT_FOUND]")
    && !detailText.includes("[HALLUCINATION_DETECTED]")
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
  const searchText = toolText(searchResult);
  const candidates = parseDecisionSearchResults(searchText);
  const candidate = candidates.find(
    (item) => caseNumberIncludes(item.caseNumber, caseRequest.caseNumber),
  );
  if (searchText.includes("[NOT_FOUND]")) {
    return {
      status: "not_found",
      caseNumber: caseRequest.caseNumber,
      candidates: candidates.map((item) => item.caseNumber).filter(Boolean),
    };
  }

  // An upstream/API error is not evidence that the requested case does not
  // exist. Keep the result in the verification-failure path so the product
  // does not show a false direct-miss message.
  if (searchResult.isError || !candidate) {
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
  const options = { signal: abortSignal };
  const items = [];
  for (const caseRequest of route.cases) {
    items.push(await lookupOne(caseRequest, options));
  }
  return {
    route: "direct",
    query,
    requestedCaseNumbers: route.cases.map((item) => item.caseNumber),
    ignoredCaseCount: route.ignoredCaseCount,
    items,
  };
}
