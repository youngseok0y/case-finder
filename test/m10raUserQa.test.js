import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { buildLunaNativePrompt } from "../src/aoV2/providers/codexNativeAo.js";
import { createEvidenceLedger, parseProviderCompoundCaseNumber } from "../src/aoV2/evidenceLedger.js";
import { renderResults } from "../src/renderer.js";
import {
  caseNumberIncludes,
  caseNumberMatches,
  extractCaseNumbers,
  routeQuery,
} from "../src/router.js";
import { createLunaNativeAdapter } from "../src/searchAdapters/lunaNativeAdapter.js";

function createLawGateway({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async execute(name, args) {
      calls.push({ name, args });
      if (fail) return { isError: true, items: [], rawText: "[NOT_FOUND]" };
      if (name === "search_law") {
        return {
          isError: false,
          items: [{ title: "민법", lawId: "law-civil", mst: "284415", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=284415" }],
          rawText: "",
        };
      }
      return { isError: false, rawText: "제750조 손해배상의 범위에 관한 provider 원문" };
    },
  };
}

function createLunaContext({ references = "민법 제750조", failLaw = false, caseNumbers = ["2020다1234"] } = {}) {
  const ledger = createEvidenceLedger({ provider: "codex_luna_test" });
  const gateway = createLawGateway({ fail: failLaw });
  for (const [index, caseNumber] of caseNumbers.entries()) {
    ledger.recordDecisionSearch({
      query: "fixture",
      domain: "precedent",
      items: [{ id: `d${index + 1}`, caseNumber, title: `fixture ${index + 1}` }],
    });
    ledger.recordDecisionDetail({
      domain: "precedent",
      id: `d${index + 1}`,
      caseNumber,
      rawText: "provider detail",
      detail: { sections: { 참조조문: references } },
    });
  }
  return {
    gateway,
    ledger,
    telemetry: { mcpCallsTotal: 0 },
    result: {
      selected: caseNumbers.map((caseNumber) => ({ case_no: caseNumber, match: "related" })),
      intro: "관련 기준을 확인했어요.",
    },
  };
}

test("M10R-A accepts historical two-digit-year case numbers without century expansion", () => {
  assert.deepEqual(extractCaseNumbers("99두2963"), [{
    caseNumber: "99두2963",
    typeCode: "두",
    domain: "precedent",
  }]);
  assert.equal(routeQuery("99두2963").kind, "direct");
  assert.equal(caseNumberMatches("99두2963", "99두2963"), true);
  assert.equal(caseNumberIncludes("99두2963", "99두2963"), true);
  assert.equal(routeQuery("91다12752").kind, "direct");
  assert.equal(routeQuery("95다33238").kind, "direct");
  assert.equal(extractCaseNumbers("999두2963").length, 0);
  assert.equal(extractCaseNumbers("9두2963").length, 0);
  assert.equal(extractCaseNumbers("99ABC2963").length, 0);
  assert.equal(routeQuery("2000다12345").kind, "direct");
  assert.equal(routeQuery("2021누40722").kind, "direct");
  assert.equal(routeQuery("2017다292343").kind, "direct");
});

test("M10R-A verifies historical case identity in EvidenceLedger", () => {
  const ledger = createEvidenceLedger({ provider: "historical_case_test" });
  ledger.recordDecisionSearch({
    query: "99두2963",
    domain: "precedent",
    items: [{ id: "historical-1", caseNumber: "99두2963" }],
  });
  const detail = ledger.recordDecisionDetail({
    domain: "precedent",
    id: "historical-1",
    caseNumber: "99두2963",
    rawText: "provider historical detail",
  });
  assert.equal(detail.verified, true);
  assert.equal(ledger.isFinalEligible("99두2963"), true);
  assert.equal(ledger.getCase("1999두2963"), null);
});

test("M10R-A expands historical compound case numbers without changing the year", () => {
  assert.deepEqual(parseProviderCompoundCaseNumber("99두2963, 2964"), {
    rawCaseNumber: "99두2963, 2964",
    canonicalMembers: ["99두2963", "99두2964"],
    acceptedEvidenceKeys: ["99두2963|99두2964", "99두2963", "99두2964"],
    ambiguous: false,
  });
});

test("M10R-A derives deduplicated provider law references for verified Luna cases", async () => {
  const context = createLunaContext({ references: "민법 제750조 / 민법 제750조", caseNumbers: ["2020다1234", "2021다5678"] });
  const adapter = createLunaNativeAdapter({
    createSearch: () => ({ async runWithContext() { return context; } }),
  });
  const result = await adapter.runNaturalQuery("손해배상");
  assert.equal(result.terminalState, "SUCCESS");
  assert.equal(result.items.length, 2);
  assert.equal(result.lawReferences.length, 1);
  assert.deepEqual(result.items.map((item) => item.lawReferences.length), [1, 1]);
  assert.equal(result.lawReferences[0].lawName, "민법");
  assert.equal(result.lawReferences[0].article, "제750조");
  assert.match(result.lawReferences[0].link, /law\.go\.kr/u);
  assert.deepEqual(context.gateway.calls.map((call) => call.name), ["search_law", "get_law_text"]);
  const html = renderResults(result);
  assert.match(html, /<h2>관련 법규<\/h2>/u);
  assert.match(html, /민법 제750조/u);
});

test("M10R-A keeps verified Luna cases successful when law enrichment fails", async () => {
  const context = createLunaContext({ failLaw: true });
  const adapter = createLunaNativeAdapter({
    createSearch: () => ({ async runWithContext() { return context; } }),
  });
  const result = await adapter.runNaturalQuery("손해배상");
  assert.equal(result.terminalState, "SUCCESS");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, "verified");
  assert.deepEqual(result.lawReferences, []);
  assert.doesNotMatch(renderResults(result), /<h2>관련 법규<\/h2>/u);
});

test("M10R-A omits law enrichment when verified detail has no statute references", async () => {
  const context = createLunaContext({ references: "", failLaw: false });
  const adapter = createLunaNativeAdapter({
    createSearch: () => ({ async runWithContext() { return context; } }),
  });
  const result = await adapter.runNaturalQuery("판례 질문");
  assert.equal(result.items[0].status, "verified");
  assert.deepEqual(result.lawReferences, []);
  assert.deepEqual(context.gateway.calls, []);
});

test("M10R-A pins 해요체 guidance in Gemini selection and Luna prompts", async () => {
  const selectPrompt = await fs.readFile(new URL("../prompts/select.txt", import.meta.url), "utf8");
  assert.match(selectPrompt, /해요체/u);
  assert.match(selectPrompt, /-습니다\/ -입니다|-습니다\/-입니다/u);
  assert.match(buildLunaNativePrompt("fixture query"), /해요체/u);
  assert.match(buildLunaNativePrompt("fixture query"), /-해요\/-이에요\/-예요/u);
});
