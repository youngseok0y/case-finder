import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRefinementInput,
  generateRefinedPlan,
  validateRefinedPlan,
} from "../src/gemini.js";
import { collectCandidates, runDeterministicPipeline } from "../src/nlPipeline.js";

function contentResult(text) {
  return { content: [{ type: "text", text }], isError: false };
}

function searchText(caseNumbers) {
  return caseNumbers.map((caseNumber, index) => [
    `[${index + 1}] fixture ${caseNumber}`,
    `사건번호: ${caseNumber}`,
    "법원: 헌법재판소",
    "선고일: 2024. 1. 1.",
  ].join("\n")).join("\n");
}

test("refinement model input contains only first-pass query statistics", async () => {
  const firstPass = [
    { query: "낙태죄", domain: "constitutional", kind: "anchor", result_count: 0, is_error: true },
    { query: "형법", domain: "constitutional", kind: "support", result_count: 2, is_error: false },
  ];
  const input = buildRefinementInput("낙태하면 처벌받는 법, 아직 있는 거예요?", firstPass);
  assert.deepEqual(input, {
    user_query: "낙태하면 처벌받는 법, 아직 있는 거예요?",
    first_pass: firstPass,
  });

  let request = null;
  const plan = await generateRefinedPlan(
    input.user_query,
    firstPass,
    null,
    {
      generateContent: async (candidateRequest) => {
        request = candidateRequest;
        return {
          text: JSON.stringify({
            queries: [
              { query: "형법 제269조", domain: "constitutional", kind: "anchor" },
              { query: "임신중절", domain: "constitutional", kind: "anchor" },
            ],
          }),
        };
      },
    },
  );
  assert.deepEqual(plan.queries, [
    { query: "형법 제269조", domain: "constitutional", kind: "anchor" },
    { query: "임신중절", domain: "constitutional", kind: "anchor" },
  ]);
  assert.match(request.contents, /낙태하면 처벌받는 법/);
  assert.match(request.contents, /result_count/);
  assert.doesNotMatch(request.contents, /2017헌바127|민법 제781조|통합진보당 해산/u);
});

test("refined plans are constitutional anchors, capped at three, and exclude duplicates", () => {
  const plan = validateRefinedPlan({
    queries: [
      { query: "first query", domain: "constitutional", kind: "anchor" },
      { query: "new query", domain: "constitutional", kind: "anchor" },
      { query: "new query", domain: "precedent", kind: "support" },
      { query: "third query", domain: "constitutional", kind: "anchor" },
      { query: "fourth query", domain: "constitutional", kind: "anchor" },
      { query: "2017헌바127", domain: "constitutional", kind: "anchor" },
    ],
  }, [{ query: "first query" }]);
  assert.deepEqual(plan.queries, [
    { query: "new query", domain: "constitutional", kind: "anchor" },
    { query: "third query", domain: "constitutional", kind: "anchor" },
    { query: "fourth query", domain: "constitutional", kind: "anchor" },
  ]);
  assert.throws(
    () => validateRefinedPlan({ queries: [{ query: "first query", domain: "constitutional", kind: "anchor" }] }, [{ query: "first query" }]),
    /2개 이상의 constitutional anchor/,
  );
});

test("second-pass candidates merge evidence without duplicating a case", async () => {
  const calls = [];
  const executeTool = async (name, args) => {
    calls.push({ name, args });
    return contentResult(searchText(["2017헌바127"]));
  };
  const telemetry = { executeTool };
  const first = await collectCandidates({
    queries: [{ query: "first anchor", domain: "constitutional", kind: "anchor" }],
    law_names: [],
  }, telemetry);
  const merged = await collectCandidates({
    queries: [{ query: "refined anchor", domain: "constitutional", kind: "anchor" }],
    law_names: [],
  }, telemetry, { existingCandidates: first, phase: "second" });
  assert.equal(calls.length, 2);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].distinctQueryCount, 2);
  assert.deepEqual(merged[0].matchedQueries.map((entry) => entry.query), ["first anchor", "refined anchor"]);
});

test("refinement failure is non-fatal and keeps first-pass flow", async () => {
  const candidate = {
    id: "1",
    caseNumber: "2024헌바1",
    title: "fixture",
    court: "헌법재판소",
    date: "2024. 1. 1.",
    preview: "preview",
  };
  let collectCalls = 0;
  const result = await runDeterministicPipeline("constitutional fixture", {
    forceRefinedPass: true,
    generatePlan: async () => ({
      queries: [
        { query: "first anchor", domain: "constitutional", kind: "anchor" },
        { query: "first support", domain: "constitutional", kind: "support" },
        { query: "second support", domain: "constitutional", kind: "support" },
        { query: "second anchor", domain: "constitutional", kind: "anchor" },
      ],
      law_names: [],
    }),
    generateRefinedPlan: async () => {
      throw new Error("refinement unavailable");
    },
    collectCandidates: async () => {
      collectCalls += 1;
      return [candidate];
    },
    searchRelatedLaws: async () => [],
    lookupQueryLawReferences: async () => [],
    prepareCandidates: async (candidates) => ({ rankedCandidates: candidates, candidatesWithPreview: candidates }),
    selectCandidates: async () => ({ selected: [{ case_no: candidate.caseNumber, match: "direct" }], intro: "fixture" }),
    finalizeGeminiDResults: async ({ selection }) => ({
      route: "natural",
      query: "constitutional fixture",
      intro: selection.intro,
      selected: selection.selected.map((item) => ({ caseNumber: item.case_no, match: item.match })),
      items: [{ status: "verified", caseNumber: candidate.caseNumber }],
      lawReferences: [],
    }),
  });
  assert.equal(collectCalls, 1);
  assert.deepEqual(result.selected, [{ caseNumber: candidate.caseNumber, match: "direct" }]);
  assert.equal(result.items[0].status, "verified");
});
