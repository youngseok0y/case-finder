import {
  DIRECT_LOOKUP_MISS_PRIMARY,
  DIRECT_LOOKUP_MISS_SECONDARY,
  NO_RESULT_MESSAGE,
  SAFETY_REJECTED_MESSAGE,
  SEARCH_FAILED_MESSAGE,
} from "./productMessages.js";

const COURT_SERVICE_HOME = "https://help.scourt.go.kr/nm/main/index.html";
const COURT_COPY_SERVICE = "https://help.scourt.go.kr/portal/information/trialrecord_offer/guide/index.html";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value, expectedPath = "") {
  if (!value) return "";
  try {
    const link = new URL(String(value || ""), "https://www.law.go.kr");
    if (!["http:", "https:"].includes(link.protocol)) return "";
    const allowedHost = /(^|\.)law\.go\.kr$/iu.test(link.hostname)
      || /(^|\.)scourt\.go\.kr$/iu.test(link.hostname);
    if (!allowedHost) return "";
    const allowedPaths = Array.isArray(expectedPath) ? expectedPath : [expectedPath];
    if (allowedPaths.some(Boolean) && !allowedPaths.some((path) => link.pathname.toLowerCase() === path.toLowerCase())) return "";
    link.searchParams.delete("OC");
    return link.toString();
  } catch {
    return "";
  }
}

function textBlock(value, fallback = "법령센터 원문 참조") {
  const text = String(value || "").trim();
  return escapeHtml(text || fallback).replace(/\n/g, "<br>");
}

function renderLawReference(reference) {
  const href = safeHref(reference?.link, "/LSW/lsInfoP.do");
  const label = [reference?.lawName, reference?.article].filter(Boolean).join(" ");
  if (!label || !href) return "";
  const title = `<a class="law-label" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  const text = String(reference?.text || "").trim();
  const content = text
    ? `<details class="law-details"><summary>전문 보기</summary><p>${textBlock(text)}</p></details>`
    : `<p class="metadata">provider 원문을 확인할 수 없습니다. 법령센터 링크에서 확인해 주세요.</p>`;
  return `<li class="law-reference">${title}${content}</li>`;
}

function renderCase(item) {
  if (item?.status !== "verified") return "";
  const href = safeHref(item.link, ["/LSW/precInfoP.do", "/LSW/detcInfoP.do"]);
  const caseNumber = escapeHtml(item.caseNumber || "사건번호 미상");
  const link = href
    ? `<a class="case-number" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${caseNumber}</a>`
    : `<span class="case-number">${caseNumber}</span>`;
  const matchLabel = item.match === "direct" ? "직접 관련" : "관련 판례";
  const metadata = [item.title, item.court, item.date].filter(Boolean).map(escapeHtml).join(" · ");
  const sections = item.detail?.sections || {};
  const holding = sections.판결요지 || sections.결정요지;
  const detail = [
    sections.판시사항 ? `<div><dt>판시사항</dt><dd>${textBlock(sections.판시사항)}</dd></div>` : "",
    holding ? `<div><dt>${sections.결정요지 ? "결정요지" : "판결요지"}</dt><dd>${textBlock(holding)}</dd></div>` : "",
  ].filter(Boolean).join("");
  return `<article class="case-card"><div class="case-card-header"><span class="match-label">${escapeHtml(matchLabel)}</span><h3>${link}</h3></div>${metadata ? `<p class="metadata">${metadata}</p>` : ""}${detail ? `<dl class="case-detail">${detail}</dl>` : ""}</article>`;
}

function renderDirectMiss() {
  return `<section class="state-panel state-no-result direct-miss" data-state="NO_RESULT"><h2>사건번호 조회 결과 없음</h2><p>${escapeHtml(DIRECT_LOOKUP_MISS_PRIMARY)}</p><p class="secondary-copy">${escapeHtml(DIRECT_LOOKUP_MISS_SECONDARY)}</p><div class="cta-row"><a class="secondary-button" href="${COURT_SERVICE_HOME}" target="_blank" rel="noopener noreferrer">판결서 인터넷열람 안내</a><a class="secondary-button" href="${COURT_COPY_SERVICE}" target="_blank" rel="noopener noreferrer">판결서사본 제공신청</a></div></section>`;
}

function renderStateMessage(state, message) {
  const labels = {
    SAFETY_REJECTED: SAFETY_REJECTED_MESSAGE,
    SEARCH_FAILED: SEARCH_FAILED_MESSAGE,
    NO_RESULT: NO_RESULT_MESSAGE,
  };
  return `<section class="state-panel state-${state.toLowerCase()}" data-state="${escapeHtml(state)}"><h2>${escapeHtml(state)}</h2><p>${escapeHtml(message || labels[state] || "검색 결과를 표시할 수 없습니다.")}</p></section>`;
}

export function renderResults(result = {}) {
  const state = result.terminalState || "SUCCESS";
  const query = `<p class="query"><span class="eyebrow">사용자 질문</span><strong>${escapeHtml(result.query)}</strong></p>`;
  if (state === "SAFETY_REJECTED" || state === "SEARCH_FAILED" || state === "NO_RESULT") {
    const empty = state === "NO_RESULT" && result.route === "direct" ? renderDirectMiss() : renderStateMessage(state);
    return `<div class="fable-results" data-terminal-state="${escapeHtml(state)}">${query}${empty}<p class="disclaimer">본 결과는 법제처 국가법령정보 Open API 데이터를 기반으로 하며, 법률 자문이 아닙니다.</p></div>`;
  }

  const items = (Array.isArray(result.items) ? result.items : []).filter((item) => item?.status === "verified");
  const laws = [];
  const seenLaws = new Set();
  for (const law of result.lawReferences || []) {
    const key = `${law?.lawName || ""}|${law?.article || ""}|${law?.link || ""}`;
    if (seenLaws.has(key)) continue;
    seenLaws.add(key);
    const rendered = renderLawReference(law);
    if (rendered) laws.push(rendered);
  }
  for (const item of items) {
    for (const law of item.lawReferences || []) {
      const key = `${law?.lawName || ""}|${law?.article || ""}|${law?.link || ""}`;
      if (seenLaws.has(key)) continue;
      seenLaws.add(key);
      const rendered = renderLawReference(law);
      if (rendered) laws.push(rendered);
    }
  }

  const allRelated = items.length > 0 && items.every((item) => item.match === "related");
  const caseHeading = items.length === 0
    ? "관련 판례"
    : allRelated ? "관련 판례 · 질문과 정확히 일치하는 판례 없음" : "관련 판례";
  const cases = items.length > 0
    ? items.map(renderCase).join("")
    : `<p class="empty">${escapeHtml(NO_RESULT_MESSAGE)}</p>`;
  const lawSection = laws.length > 0 ? `<section class="result-section"><h2>관련 법규</h2><ul class="law-list">${laws.join("")}</ul></section>` : "";
  const intro = result.intro ? `<p class="intro">${textBlock(result.intro)}</p>` : "";
  const fallback = result.fallbackLabel ? `<p class="notice">${escapeHtml(result.fallbackLabel)}</p>` : "";
  const ignored = result.ignoredCaseCount > 0
    ? `<p class="notice">사건번호는 최대 5개까지만 조회했습니다. 초과한 ${escapeHtml(result.ignoredCaseCount)}개는 무시했습니다.</p>`
    : "";
  return `<div class="fable-results" data-terminal-state="SUCCESS">${query}${intro}${fallback}${ignored}<section class="result-section"><h2>${caseHeading}</h2>${cases}</section>${lawSection}<p class="disclaimer">본 결과는 법제처 국가법령정보 Open API 데이터를 기반으로 하며, 법률 자문이 아닙니다.</p></div>`;
}
