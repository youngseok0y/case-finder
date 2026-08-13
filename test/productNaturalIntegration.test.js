import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiDAdapter, createLunaNativeAdapter, toResultContract } from "../src/searchAdapters/index.js";
import { renderResults } from "../src/renderer.js";
import { validateNaturalResult } from "../src/validator.js";

const caseItem = {
  caseNumber: "2020나2027066",
  status: "verified",
  title: "배관 누수 손해배상",
  court: "서울고등법원",
  date: "2024-01-01",
  link: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=614471",
  detail: {
    caseNumber: "2020나2027066",
    rawText: "provider original text",
    sections: { 판시사항: "판시사항 원문", 판결요지: "판결요지 원문" },
  },
  lawReferences: [],
};

const lawReference = {
  lawName: "민법",
  article: "제750조",
  link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=284415",
};

async function validated(result) {
  return validateNaturalResult(result);
}

test("Gemini D adapter → contract → validator → renderer keeps verified evidence", async () => {
  const adapter = createGeminiDAdapter({
    run: async () => ({
      query: "배관 누수 손해배상",
      selected: [{ caseNumber: caseItem.caseNumber, match: "direct" }],
      items: [caseItem],
      candidateCaseNumbers: [caseItem.caseNumber],
      lawReferences: [lawReference],
    }),
  });
  const result = await validated(await adapter.runNaturalQuery("배관 누수 손해배상"));
  const html = renderResults(result);
  assert.deepEqual(result.selected, [{ caseNumber: caseItem.caseNumber, match: "direct" }]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.lawReferences, [lawReference]);
  assert.match(html, /2020나2027066/u);
  assert.match(html, /판결요지 원문/u);
  assert.match(html, /민법 제750조/u);
});

test("Luna Native adapter → contract → validator → renderer keeps verified evidence", async () => {
  const adapter = createLunaNativeAdapter({
    run: async () => ({
      query: "배관 누수 손해배상",
      selected: [{ case_no: caseItem.caseNumber, match: "related" }],
      items: [caseItem],
      candidateCaseNumbers: [caseItem.caseNumber],
    }),
  });
  const result = await validated(await adapter.runNaturalQuery("배관 누수 손해배상"));
  const html = renderResults(result);
  assert.equal(result.provider, "codex_luna");
  assert.equal(result.items.length, 1);
  assert.match(html, /2020나2027066/u);
  assert.match(html, /판시내용/u);
});

test("outputValid=false is a safety terminal, not an ordinary NO_RESULT", async () => {
  const rejected = toResultContract({
    output_valid: false,
    selected: [],
    items: [],
    protocol_diagnostics: [{ code: "AO_V2_LUNA_TOOL_CONTAMINATION" }],
    query: "안전성 테스트",
  }, { adapterId: "luna_native", provider: "codex_luna", architecture: "AO_V2_NATIVE" });
  const result = await validated(rejected);
  const html = renderResults(result);
  assert.equal(result.terminalState, "SAFETY_REJECTED");
  assert.doesNotMatch(html, /관련판례 \(/u);
  assert.match(html, /안전하게 검증하지 못해 결과를 표시하지 않았습니다/u);
});
