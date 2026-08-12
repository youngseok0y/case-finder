import assert from "node:assert/strict";
import { rankCandidates, runDeterministicPipeline } from "../src/nlPipeline.js";

const baseCandidate = {
  id: "fixture-1",
  caseNumber: "2020다12345",
  title: "fixture",
  court: "대법원",
  date: "20200101",
  domain: "precedent",
  matchedKeywords: new Set(["fixture", "keyword"]),
  preview: "fixture preview",
};

function deps() {
  const calls = { selectionInputs: [], finalInputs: [] };
  const candidate = { ...baseCandidate, matchedKeywords: new Set(baseCandidate.matchedKeywords) };
  return {
    calls,
    generatePlan: async () => ({ keywords: ["fixture"], law_names: [], domains: ["precedent"] }),
    collectCandidates: async () => [{ ...candidate, matchedKeywords: new Set(candidate.matchedKeywords) }],
    searchRelatedLaws: async () => [],
    lookupQueryLawReferences: async () => [],
    prepareCandidates: async (candidates) => {
      const ranked = rankCandidates(candidates);
      return { rankedCandidates: ranked, candidatesWithPreview: ranked };
    },
    selectCandidates: async (_query, candidates) => {
      calls.selectionInputs.push(candidates.map((item) => item.caseNumber));
      return { selected: [{ case_no: candidates[0].caseNumber, match: "direct" }], intro: "fixture intro" };
    },
    finalizeSelection: async ({ candidatesWithPreview, selection }) => {
      calls.finalInputs.push({
        candidates: candidatesWithPreview.map((item) => item.caseNumber),
        selection: structuredClone(selection),
      });
      const candidate = candidatesWithPreview[0];
      return {
        route: "natural",
        query: "fixture query",
        intro: selection.intro,
        fallbackLabel: "",
        lawReferences: [],
        candidateCaseNumbers: candidatesWithPreview.map((item) => item.caseNumber),
        selected: [{ caseNumber: candidate.caseNumber, match: selection.selected[0].match }],
        items: [{
          ...candidate,
          status: "verified",
          detail: { caseNumber: candidate.caseNumber, rawText: "fixture raw" },
          match: selection.selected[0].match,
        }],
      };
    },
  };
}

function comparable(result) {
  const copy = structuredClone(result);
  delete copy.d_trace;
  delete copy.metrics.elapsed_ms;
  return copy;
}

process.env.M6E_D_TRACE = "0";
const offDeps = deps();
const off = await runDeterministicPipeline("fixture query", offDeps);
process.env.M6E_D_TRACE = "1";
const onDeps = deps();
const on = await runDeterministicPipeline("fixture query", onDeps);

assert.deepEqual(comparable(on), comparable(off), "instrumentation changed product output");
assert.deepEqual(onDeps.calls.selectionInputs, offDeps.calls.selectionInputs, "selection input changed");
assert.deepEqual(onDeps.calls.finalInputs, offDeps.calls.finalInputs, "finalization input changed");
assert.equal(on.d_trace.schema_version, "m6e-d-trace-v1");
assert.equal(on.d_trace.raw_selection.raw_selected_count, 1);
assert.equal(on.d_trace.raw_selection.raw_selection_empty, false);
assert.equal(on.d_trace.final_selection.final_selected_count, 1);
assert.equal(on.d_trace.candidates.raw_candidate_count, 1);

console.log(JSON.stringify({
  checkpoint: "M6E_D_TRACE_INSTRUMENTATION_PARITY_PASS",
  same_product_output: true,
  same_selection_input: true,
  same_finalization_input: true,
  trace_fields_asserted: ["plan", "candidates", "raw_selection", "final_selection"],
}, null, 2));
