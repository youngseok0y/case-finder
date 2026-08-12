import { config } from "../config.js";
import { callTool } from "./mcpClient.js";
import { caseNumberIncludes, normalizeCaseNumber } from "./router.js";

const DETAIL_SECTIONS = ["판시사항", "판결요지", "결정요지", "재결주문", "재결요지", "참조조문", "참조판례", "이유", "전문"];
const ARTICLE_PATTERN = /(?:제)?\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?/g;

export function toolText(result) {
  return result?.content?.find((item) => item.type === "text")?.text || "";
}

export function recordMcpCall(telemetry, name) {
  if (!telemetry) return;
  telemetry.mcpCallsTotal = (telemetry.mcpCallsTotal || 0) + 1;
  if (name === "search_decisions" || name === "search_law") telemetry.mcpSearchCalls = (telemetry.mcpSearchCalls || 0) + 1;
  if (name === "get_decision_text" || name === "get_law_text") telemetry.mcpDetailCalls = (telemetry.mcpDetailCalls || 0) + 1;
}

export async function trackedCallTool(name, args, telemetry = null) {
  recordMcpCall(telemetry, name);
  return callTool(name, args);
}

function decodeBasicHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/\r/g, "");
}

function cleanText(value) {
  return decodeBasicHtml(value).trim();
}

function parseLabeledField(text, label) {
  const match = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]*)`, "m"));
  return cleanText(match?.[1] || "");
}

export function parseDecisionSearchResults(rawText) {
  const text = decodeBasicHtml(rawText);
  const lines = text.split("\n");
  const results = [];
  let current = null;

  for (const line of lines) {
    const hit = line.match(/^\s*(?:[-*]\s*)?\[(\d+)\]\s*(.*?)\s*$/);
    if (hit) {
      if (current) results.push(current);
      current = {
        id: hit[1],
        title: cleanText(hit[2]),
        caseNumber: "",
        court: "",
        date: "",
        type: "",
        link: "",
      };
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s*(사건번호|법원|선고일|종국일|종국일자|의결일|의결일자|사건종류|판결유형|링크)\s*:\s*(.*?)\s*$/);
    if (!field) continue;
    const keyMap = {
      사건번호: "caseNumber",
      법원: "court",
      선고일: "date",
      종국일: "date",
      종국일자: "date",
      의결일: "date",
      의결일자: "date",
      사건종류: "caseType",
      판결유형: "type",
      링크: "link",
    };
    current[keyMap[field[1]]] = cleanText(field[2]);
  }
  if (current) results.push(current);
  return results;
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

export function parseDecisionDetail(rawText) {
  const text = decodeBasicHtml(rawText);
  const sections = {};
  const sectionPattern = new RegExp(
    `(?:^|\\n)\\s*(${DETAIL_SECTIONS.join("|")})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${DETAIL_SECTIONS.join("|")})\\s*:|$)`,
    "g",
  );
  for (const match of text.matchAll(sectionPattern)) {
    sections[match[1]] = cleanText(match[2]);
  }

  return {
    caseNumber: parseLabeledField(text, "사건번호"),
    court: parseLabeledField(text, "법원"),
    date: parseLabeledField(text, "선고일")
      || parseLabeledField(text, "종국일자")
      || parseLabeledField(text, "종국일")
      || parseLabeledField(text, "의결일자")
      || parseLabeledField(text, "의결일"),
    caseType: parseLabeledField(text, "사건종류"),
    type: parseLabeledField(text, "판결유형"),
    sections,
    rawText: text,
  };
}

export function parseLawSearchResults(rawText) {
  const text = decodeBasicHtml(rawText);
  const lines = text.split("\n");
  const results = [];
  let current = null;
  for (const line of lines) {
    const title = line.match(/^\s*(?:\d+\.\s*)?(?:[-*]\s*)?(.+?)\s+\[(?:현행|연혁)\]\s*$/);
    if (title) {
      if (current) results.push(current);
      current = { title: cleanText(title[1]), lawId: "", mst: "", link: "" };
      continue;
    }
    if (!current) continue;
    const mst = line.match(/^\s*[-*]?\s*MST\s*:\s*(\S+)/i);
    if (mst) current.mst = mst[1];
    const lawId = line.match(/^\s*-?\s*법령ID\s*:\s*(\S+)/);
    if (lawId) current.lawId = lawId[1];
    const link = line.match(/^\s*[-*]?\s*링크\s*:\s*(.*?)\s*$/);
    if (link) current.link = cleanText(link[1]);
  }
  if (current) results.push(current);
  return results;
}

export function lawDetailLink(mst) {
  return /^\d+$/.test(String(mst || ""))
    ? `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${encodeURIComponent(mst)}`
    : "";
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
  for (const clause of cleanText(referenceText).split(/\s*\/\s*/)) {
    const articleIndex = clause.search(/(?:제)?\d+조/);
    if (articleIndex < 0) continue;
    const lawMatch = clause.slice(0, articleIndex).match(/([가-힣][가-힣0-9·()「」ㆍ\s]{0,39}법)\s*$/);
    const lawName = lawMatch?.[1]?.replace(/^\[\d+\]\s*/, "").trim();
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

export async function enrichLawReferences(referenceText, telemetry = null) {
  const references = parseStatuteReferences(referenceText).slice(0, config.lawMax);
  const enriched = [];
  for (const reference of references) {
    try {
      const searchResult = await trackedCallTool("search_law", {
        query: reference.lawName,
        display: 5,
      }, telemetry);
      const candidates = parseLawSearchResults(toolText(searchResult));
      const candidateNames = [reference.lawName];
      if (reference.lawName === "헌법") candidateNames.push("대한민국헌법");
      const candidate = candidates.find((item) => candidateNames.some((name) => normalizeCaseNumber(item.title) === normalizeCaseNumber(name)));
      if (!candidate?.mst) {
        enriched.push({ ...reference, text: "", link: "" });
        continue;
      }
      const lawResult = await trackedCallTool("get_law_text", {
        mst: candidate.mst,
        jo: reference.article,
      }, telemetry);
      const lawText = cleanLawArticleText(toolText(lawResult));
      if (lawResult.isError || !lawText || lawText.includes("[NOT_FOUND]")) {
        enriched.push({ ...reference, text: "", link: sanitizeApiLink(candidate.link, candidate.mst) || lawDetailLink(candidate.mst) });
        continue;
      }
      enriched.push({
        ...reference,
        text: lawText,
        link: sanitizeApiLink(candidate.link, candidate.mst) || lawDetailLink(candidate.mst),
      });
    } catch {
      enriched.push({ ...reference, text: "", link: "" });
    }
  }
  return enriched;
}

export async function lookupDecisionCandidate(candidate, domain = "precedent", prefetched = null, telemetry = null) {
  const detailResult = prefetched?.result || await trackedCallTool("get_decision_text", {
    domain,
    id: candidate.id,
    full: false,
  }, telemetry);
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
    link: sanitizeApiLink(candidate.link, candidate.id),
    detail,
    lawReferences: detailValid ? await enrichLawReferences(detail.sections.참조조문 || "", telemetry) : [],
  };
}

async function lookupOne(caseRequest) {
  const options = { caseNumber: caseRequest.caseNumber };
  if (caseRequest.domain === "precedent") options.search = 2;
  const searchResult = await callTool("search_decisions", {
    domain: caseRequest.domain,
    options,
    display: 100,
  });
  const searchText = toolText(searchResult);
  const candidates = parseDecisionSearchResults(searchText);
  const candidate = candidates.find(
    (item) => caseNumberIncludes(item.caseNumber, caseRequest.caseNumber),
  );
  if (searchResult.isError || searchText.includes("[NOT_FOUND]") || !candidate) {
    return {
      status: "not_found",
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
  );
}

export async function lookupDirect(query, route) {
  const items = [];
  for (const caseRequest of route.cases) {
    items.push(await lookupOne(caseRequest));
  }
  return {
    route: "direct",
    query,
    requestedCaseNumbers: route.cases.map((item) => item.caseNumber),
    ignoredCaseCount: route.ignoredCaseCount,
    items,
  };
}
