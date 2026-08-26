import assert from "node:assert/strict";
import test from "node:test";

import { collectCandidates, rankCandidates } from "../src/nlPipeline.js";

function evidence(query, kind, providerRank = 1, domain = "precedent") {
  return { query, kind, providerRank, domain };
}

function candidate(caseNumber, matchedQueries, overrides = {}) {
  return {
    id: caseNumber,
    caseNumber,
    title: caseNumber,
    court: "대법원",
    date: "2024. 1. 1.",
    domain: "precedent",
    matchedQueries,
    ...overrides,
  };
}

test("anchor rank 5 outranks repeated support hits", () => {
  const ranked = rankCandidates([
    candidate("anchor", [evidence("distinctive statute", "anchor", 5, "constitutional")], { court: "" }),
    candidate("repeated-support", [
      evidence("support-1", "support"),
      evidence("support-2", "support"),
      evidence("support-3", "support"),
      evidence("support-4", "support"),
    ]),
  ], { limit: false });
  assert.equal(ranked[0].caseNumber, "anchor");
});

test("corroboration bonus is capped at three additional query hits", () => {
  const fourHits = candidate("four", [
    evidence("q1", "support"), evidence("q2", "support"), evidence("q3", "support"), evidence("q4", "support"),
  ]);
  const fiveHits = candidate("five", [
    evidence("q1", "support"), evidence("q2", "support"), evidence("q3", "support"), evidence("q4", "support"), evidence("q5", "support"),
  ]);
  const ranked = rankCandidates([fourHits, fiveHits], { limit: false });
  assert.equal(ranked.find((item) => item.caseNumber === "four").score, ranked.find((item) => item.caseNumber === "five").score);
});

test("constitutional candidates receive court authority when court is empty", () => {
  const ranked = rankCandidates([
    candidate("constitutional", [evidence("issue", "anchor", 1, "constitutional")], { court: "", domain: "constitutional" }),
    candidate("ordinary", [evidence("issue", "anchor", 1, "precedent")], { court: "", domain: "precedent" }),
  ], { limit: false });
  assert.equal(ranked[0].caseNumber, "constitutional");
});

test("candidateMax remains 20", () => {
  const candidates = Array.from({ length: 21 }, (_, index) => candidate(`case-${String(index).padStart(2, "0")}`, [evidence(`q-${index}`, "support")]));
  assert.equal(rankCandidates(candidates).length, 20);
  assert.equal(rankCandidates(candidates, { limit: false }).length, 21);
});

test("queries are searched only in their declared domains", async () => {
  const calls = [];
  const result = await collectCandidates({
    queries: [
      { query: "constitutional anchor", domain: "constitutional", kind: "anchor" },
      { query: "precedent support", domain: "precedent", kind: "support" },
    ],
    law_names: [],
  }, {
    executeTool: async (name, args) => {
      calls.push({ name, args });
      return {
        isError: false,
        content: [{
          type: "text",
          text: "[1] domain fixture\n사건번호: 2024다00001\n법원: 대법원\n선고일: 2024. 1. 1.",
        }],
      };
    },
  });
  assert.deepEqual(calls.map((call) => [call.name, call.args.query, call.args.domain]), [
    ["search_decisions", "constitutional anchor", "constitutional"],
    ["search_decisions", "precedent support", "precedent"],
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].distinctQueryCount, 2);
});
