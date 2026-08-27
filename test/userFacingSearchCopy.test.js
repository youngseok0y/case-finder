import assert from "node:assert/strict";
import test from "node:test";

import { SEARCH_FAILED_MESSAGE, SEARCH_STATUS_LABELS } from "../src/productMessages.js";
import { renderResults } from "../src/renderer.js";

test("related-only result uses bounded search wording", () => {
  const html = renderResults({
    query: "관련 판례 질문",
    terminalState: "SUCCESS",
    items: [{
      status: "verified",
      caseNumber: "2024다00001",
      match: "related",
      title: "관련 사건",
      court: "대법원",
      date: "20240101",
      detail: { sections: { 판시사항: "관련 법리" } },
    }],
    lawReferences: [],
  });

  assert.match(html, /현재 검색 결과에서 질문과 직접 일치하는 판례는 확인되지 않았습니다/u);
  assert.doesNotMatch(html, /질문과 정확히 일치하는 판례는 없습니다/u);
});

test("search failure copy covers both search and detail verification", () => {
  const html = renderResults({
    query: "검색 실패 질문",
    terminalState: "SEARCH_FAILED",
    items: [],
    lawReferences: [],
  });

  assert.equal(SEARCH_STATUS_LABELS.SEARCH_FAILED, "검색 검증 실패");
  assert.equal(SEARCH_FAILED_MESSAGE, "판례 검색 또는 원문 검증 과정에서 오류가 발생해 결과를 표시하지 않았습니다. 다시 검색하거나 잠시 후 다시 시도해 주세요.");
  assert.match(html, /검색 검증에 실패했습니다/u);
  assert.match(html, /판례 검색 또는 원문 검증 과정에서 오류가 발생해 결과를 표시하지 않았습니다/u);
});
