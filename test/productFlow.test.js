import assert from "node:assert/strict";
import test from "node:test";
import { decisionDetailLink, lawDetailLink } from "../src/directLookup.js";
import { renderResults } from "../src/renderer.js";
import { createGeminiDAdapter, createLunaNativeAdapter, toResultContract } from "../src/searchAdapters/index.js";
import { validateNaturalResult } from "../src/validator.js";
import { routeQuery } from "../src/router.js";

const caseItem = {
  status: "verified",
  caseNumber: "2020나2027066",
  providerId: "614471",
  title: "배관 누수 손해배상",
  court: "서울고등법원",
  date: "2024-01-01",
  link: decisionDetailLink("precedent", "614471"),
  detail: { caseNumber: "2020나2027066", rawText: "provider original text", sections: {} },
};

async function valid(result) {
  return validateNaturalResult(result);
}

test("direct case routing stays deterministic", () => {
  assert.deepEqual(routeQuery("2020다1234 확인").kind, "direct");
  assert.equal(routeQuery("계약 해지 손해배상").kind, "natural");
});

test("Gemini and Luna adapters map verified provider results to the same product flow", async () => {
  const gemini = createGeminiDAdapter({ run: async () => ({
    query: "배관 누수 손해배상",
    selected: [{ caseNumber: caseItem.caseNumber, match: "direct" }],
    items: [caseItem],
    candidateCaseNumbers: [caseItem.caseNumber],
    lawReferences: [{ lawName: "민법", article: "제750조", link: lawDetailLink("284415") }],
  }) });
  const luna = createLunaNativeAdapter({ run: async () => ({
    query: "배관 누수 손해배상",
    selected: [{ case_no: caseItem.caseNumber, match: "related" }],
    items: [caseItem],
    candidateCaseNumbers: [caseItem.caseNumber],
  }) });

  const geminiResult = await valid(await gemini.runNaturalQuery("배관 누수 손해배상"));
  const lunaResult = await valid(await luna.runNaturalQuery("배관 누수 손해배상"));
  assert.equal(geminiResult.items.length, 1);
  assert.equal(lunaResult.items.length, 1);
  assert.equal(lunaResult.provider, "codex_luna");
  assert.match(renderResults(geminiResult), /2020나2027066/u);
  assert.match(renderResults(lunaResult), /2020나2027066/u);
});

test("provider links and empty/failure terminal contracts remain honest", () => {
  assert.equal(decisionDetailLink("precedent", "614471"), "https://www.law.go.kr/LSW/precInfoP.do?precSeq=614471");
  assert.equal(lawDetailLink("284415"), "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=284415");
  assert.equal(toResultContract({ query: "empty", selected: [], items: [], candidateCaseNumbers: [] }, {
    adapterId: "gemini_d", provider: "gemini", architecture: "D",
  }).terminalState, "NO_RESULT");
  assert.equal(toResultContract({ query: "failure", error: "provider unavailable", selected: [], items: [], candidateCaseNumbers: [] }, {
    adapterId: "luna_native", provider: "codex_luna", architecture: "AO_V2_NATIVE",
  }).terminalState, "SEARCH_FAILED");
});
