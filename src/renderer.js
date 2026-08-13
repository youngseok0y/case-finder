import { SAFETY_REJECTED_MESSAGE, SEARCH_FAILED_MESSAGE } from "./productMessages.js";

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
    if (!/(^|\.)law\.go\.kr$/i.test(link.hostname)) return "";
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
  const label = [reference.lawName, reference.article].filter(Boolean).join(" ");
  const content = reference.text ? textBlock(reference.text) : "법령센터 원문 참조";
  const href = safeHref(reference.link, "/LSW/lsInfoP.do");
  const title = href
    ? `<a class="law-label" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : `<span class="law-label">${escapeHtml(label)}</span>`;
  return `<li>${title} : ${content}</li>`;
}

function renderCase(item, showDetail) {
  const href = safeHref(item.link, ["/LSW/precInfoP.do", "/LSW/detcInfoP.do"]);
  const link = href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.caseNumber)}</a>`
    : escapeHtml(item.caseNumber);
  const metadata = [item.title, item.court, item.date].filter(Boolean).map(escapeHtml).join(" · ");
  const holding = item.detail?.sections?.판결요지 || item.detail?.sections?.결정요지;
  const detail = showDetail
    ? `<div class="case-detail"><p><strong>판시내용</strong> : ${textBlock(item.detail?.sections?.판시사항)}</p><p><strong>${item.detail?.sections?.결정요지 ? "결정요지" : "판결요지"}</strong> : ${textBlock(holding)}</p></div>`
    : "";
  return `<article class="case"><h3>${link}</h3>${metadata ? `<p class="metadata">${metadata}</p>` : ""}${detail}</article>`;
}

export function renderResults(result) {
  if (result.outputValid === false || result.terminalState === "SAFETY_REJECTED") {
    return `<div class="fable-results"><p class="query"><strong>사용자 질문</strong> : ${escapeHtml(result.query)}</p><p class="error">${escapeHtml(SAFETY_REJECTED_MESSAGE)}</p><p class="disclaimer">본 결과는 법제처 국가법령정보 Open API 데이터를 그대로 표시한 것으로, 법률 자문이 아닙니다.</p></div>`;
  }
  if (result.terminalState === "SEARCH_FAILED") {
    return `<div class="fable-results"><p class="query"><strong>사용자 질문</strong> : ${escapeHtml(result.query)}</p><p class="error">${escapeHtml(SEARCH_FAILED_MESSAGE)}</p><p class="disclaimer">본 결과는 법제처 국가법령정보 Open API 데이터를 그대로 표시한 것으로, 법률 자문이 아닙니다.</p></div>`;
  }
  const items = result.items || [];
  const laws = [];
  const seenLaws = new Set();
  for (const law of result.lawReferences || []) {
    const key = `${law.lawName}|${law.article}`;
    if (seenLaws.has(key)) continue;
    seenLaws.add(key);
    laws.push(law);
  }
  for (const item of items) {
    for (const law of item.lawReferences || []) {
      const key = `${law.lawName}|${law.article}`;
      if (seenLaws.has(key)) continue;
      seenLaws.add(key);
      laws.push(law);
    }
  }

  const lawSection = laws.length > 0
    ? `<section><h2>관련법규</h2><ul>${laws.map(renderLawReference).join("")}</ul></section>`
    : "";
  const allRelated = items.length > 0 && items.every((item) => item.match === "related");
  const caseHeading = items.length === 0
    ? "관련판례 (정확히 일치하는 판례를 찾지 못했습니다)"
    : allRelated ? "관련판례 (질문과 정확히 일치하는 판례는 찾지 못했습니다)" : "관련판례";
  const caseSection = items.length > 0
    ? `<section><h2>${caseHeading}</h2>${items.map((item) => renderCase(item, true)).join("")}</section>`
    : `<section><h2>${caseHeading}</h2><p class="empty">법령센터에서 해당 사건번호를 찾지 못했습니다. 사건번호를 확인해 주세요.</p></section>`;
  const ignored = result.ignoredCaseCount > 0
    ? `<p class="notice">사건번호는 최대 5개까지만 조회했습니다. 초과한 ${escapeHtml(result.ignoredCaseCount)}개는 무시했습니다.</p>`
    : "";
  const intro = result.intro ? `<p class="intro">${textBlock(result.intro)}</p>` : "";
  const fallback = result.fallbackLabel ? `<p class="notice">${escapeHtml(result.fallbackLabel)}</p>` : "";

  return `<div class="fable-results"><p class="query"><strong>사용자 질문</strong> : ${escapeHtml(result.query)}</p>${intro}${fallback}${ignored}${lawSection}${caseSection}<p class="disclaimer">본 결과는 법제처 국가법령정보 Open API 데이터를 그대로 표시한 것으로, 법률 자문이 아닙니다.</p></div>`;
}
