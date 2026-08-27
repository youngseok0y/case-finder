import {
  DIRECT_LOOKUP_MISS_PRIMARY,
  DIRECT_LOOKUP_MISS_SECONDARY,
  NO_RESULT_MESSAGE,
  SAFETY_REJECTED_MESSAGE,
  SEARCH_FAILED_MESSAGE,
} from "./productMessages.js";

const COURT_DECISION_VIEW_URL = "https://portal.scourt.go.kr/pgp/index.on?m=PGP202M01&l=Y&c=400";
const COURT_DECISION_COPY_URL = "https://portal.scourt.go.kr/pgp/index.on?m=PGP201M01A&l=Y&c=300";

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
    : `<p class="metadata">조문 본문을 불러오지 못했어요. 위 링크에서 확인해 주세요.</p>`;
  return `<li class="law-reference">${title}${content}</li>`;
}

function renderLawSection(references) {
  const laws = [];
  const seenLaws = new Set();
  for (const law of references || []) {
    const key = `${law?.lawName || ""}|${law?.article || ""}|${law?.link || ""}`;
    if (seenLaws.has(key)) continue;
    seenLaws.add(key);
    const rendered = renderLawReference(law);
    if (rendered) laws.push(rendered);
  }
  return laws.length > 0 ? `<section class="result-section"><h2>관련 법규<span class="section-count">${laws.length}건</span></h2><ul class="law-list">${laws.join("")}</ul></section>` : "";
}

function renderCase(item) {
  if (item?.status !== "verified") return "";
  const href = safeHref(item.link, ["/LSW/precInfoP.do", "/LSW/detcInfoP.do"]);
  const caseNumber = escapeHtml(item.caseNumber || "사건번호 미상");
  const link = href
    ? `<a class="case-number" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${caseNumber}</a>`
    : `<span class="case-number">${caseNumber}</span>`;
  const isDirect = item.match === "direct";
  const matchLabel = isDirect ? "직접 관련" : "관련 판례";
  const metadata = [item.title, item.court, item.date].filter(Boolean).map(escapeHtml).join(" · ");
  const sections = item.detail?.sections || {};
  const holding = sections.판결요지 || sections.결정요지;
  const holdingLabel = sections.판결요지 ? "판결요지" : "결정요지";
  const lead = sections.판시사항 || holding;
  const more = sections.판시사항 && holding
    ? `<details class="case-more"><summary>${holdingLabel}</summary><p>${textBlock(holding)}</p></details>`
    : "";
  const badge = `<span class="match-label${isDirect ? "" : " is-related"}">${escapeHtml(matchLabel)}</span>`;
  return `<article class="case-card"><div class="case-card-header"><h3>${link}</h3>${badge}</div>${metadata ? `<p class="metadata">${metadata}</p>` : ""}${lead ? `<p class="case-lead">${textBlock(lead)}</p>` : ""}${more}</article>`;
}

function renderDirectMiss() {
  return `<section class="state-panel state-no-result direct-miss" data-state="NO_RESULT"><h2>사건번호 조회 결과 없음</h2><p>${escapeHtml(DIRECT_LOOKUP_MISS_PRIMARY)}</p><p class="secondary-copy">${escapeHtml(DIRECT_LOOKUP_MISS_SECONDARY)}</p><div class="cta-row"><a class="secondary-button" href="${escapeHtml(COURT_DECISION_VIEW_URL)}" target="_blank" rel="noopener noreferrer">판결서 인터넷열람</a><a class="secondary-button" href="${escapeHtml(COURT_DECISION_COPY_URL)}" target="_blank" rel="noopener noreferrer">판결서사본 제공신청</a></div></section>`;
}

const STATE_HEADINGS = Object.freeze({
  SAFETY_REJECTED: "결과를 표시하지 않았습니다",
  SEARCH_FAILED: "검색 검증에 실패했습니다",
  NO_RESULT: "표시할 결과가 없습니다",
});

function renderStateMessage(state, message) {
  const labels = {
    SAFETY_REJECTED: SAFETY_REJECTED_MESSAGE,
    SEARCH_FAILED: SEARCH_FAILED_MESSAGE,
    NO_RESULT: NO_RESULT_MESSAGE,
  };
  const heading = STATE_HEADINGS[state] || "검색 결과를 표시할 수 없습니다";
  return `<section class="state-panel state-${state.toLowerCase()}" data-state="${escapeHtml(state)}"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message || labels[state] || "검색 결과를 표시할 수 없습니다.")}</p></section>`;
}

export function renderResults(result = {}) {
  const state = result.terminalState || "SUCCESS";
  const query = `<p class="query"><strong>${escapeHtml(result.query)}</strong> 검색 결과</p>`;
  if (state === "SAFETY_REJECTED" || state === "SEARCH_FAILED" || state === "NO_RESULT") {
    if (state === "NO_RESULT" && result.route !== "direct") {
      const rationale = result.intro
        ? `<p class="intro">${textBlock(result.intro)}</p>`
        : `<p class="empty">${escapeHtml(NO_RESULT_MESSAGE)}</p>`;
      const lawSection = renderLawSection(result.lawReferences);
      const empty = `<section class="state-panel state-no-result" data-state="NO_RESULT"><h2>${STATE_HEADINGS.NO_RESULT}</h2>${rationale}</section>`;
      return `<div class="case-finder-results" data-terminal-state="NO_RESULT">${query}${empty}${lawSection}</div>`;
    }
    const empty = state === "NO_RESULT" && result.route === "direct" ? renderDirectMiss() : renderStateMessage(state);
    return `<div class="case-finder-results" data-terminal-state="${escapeHtml(state)}">${query}${empty}</div>`;
  }

  const items = (Array.isArray(result.items) ? result.items : []).filter((item) => item?.status === "verified");
  const lawReferences = [
    ...(result.lawReferences || []),
    ...items.flatMap((item) => item.lawReferences || []),
  ];

  const allRelated = items.length > 0 && items.every((item) => item.match === "related");
  const caseHeading = [
    "관련 판례",
    items.length > 0 ? `<span class="section-count">${items.length}건</span>` : "",
    allRelated ? `<span class="section-note">현재 검색 결과에서 질문과 직접 일치하는 판례는 확인되지 않았습니다</span>` : "",
  ].filter(Boolean).join("");
  const cases = items.length > 0
    ? items.map(renderCase).join("")
    : `<p class="empty">${escapeHtml(NO_RESULT_MESSAGE)}</p>`;
  const lawSection = renderLawSection(lawReferences);
  const intro = result.intro ? `<p class="intro">${textBlock(result.intro)}</p>` : "";
  const fallback = result.fallbackLabel ? `<p class="notice">${escapeHtml(result.fallbackLabel)}</p>` : "";
  const ignored = result.ignoredCaseCount > 0
    ? `<p class="notice">사건번호는 최대 5개까지만 조회했습니다. 초과한 ${escapeHtml(result.ignoredCaseCount)}개는 무시했습니다.</p>`
    : "";
  return `<div class="case-finder-results" data-terminal-state="SUCCESS">${query}${intro}${fallback}${ignored}<section class="result-section"><h2>${caseHeading}</h2>${cases}</section>${lawSection}</div>`;
}
