import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDeterministicPipeline } from "../src/nlPipeline.js";
import { toResultContract } from "../src/searchAdapters/resultContract.js";

const RESULT_METADATA = {
  adapterId: "gemini_d",
  provider: "gemini",
  architecture: "D",
};

function contentResult(text) {
  return { content: [{ type: "text", text }], isError: false };
}

function caseNumber(index) {
  return `2024다${String(index).padStart(5, "0")}`;
}

function searchFixture() {
  return Array.from({ length: 21 }, (_, offset) => {
    const index = offset + 1;
    return [
      `[${index}] 진단 fixture ${index}`,
      `사건번호: ${caseNumber(index)}`,
      "법원: 대법원",
      "선고일: 2024. 1. 1.",
    ].join("\n");
  }).join("\n");
}

function detailFixture(id) {
  const index = Number(id);
  return [
    `사건번호: ${caseNumber(index)}`,
    "법원: 대법원",
    "선고일: 2024. 1. 1.",
    "판시사항:",
    `진단 fixture preview ${index}`,
  ].join("\n");
}

function fixtureDependencies() {
  const calls = [];
  return {
    calls,
    generatePlan: async () => ({
      queries: [
        { query: "generic phrase", domain: "precedent", kind: "support" },
        { query: "specific phrase", domain: "constitutional", kind: "anchor" },
        { query: "specific phrase", domain: "precedent", kind: "support" },
        { query: "anchor phrase", domain: "constitutional", kind: "anchor" },
      ],
      law_names: [],
    }),
    executeTool: async (name, args) => {
      calls.push({ name, args: { ...args } });
      if (name === "search_decisions") return contentResult(searchFixture());
      if (name === "get_decision_text") return contentResult(detailFixture(args.id));
      throw new Error(`unexpected fixture tool: ${name}`);
    },
    searchRelatedLaws: async () => [],
    lookupQueryLawReferences: async () => [],
    selectCandidates: async (_query, candidates) => ({
      intro: "fixture",
      selected: [{ case_no: candidates[0].caseNumber, match: "direct" }],
    }),
  };
}

async function runFixture(tracePath) {
  const dependencies = fixtureDependencies();
  const result = await runDeterministicPipeline("trace fixture", {
    ...dependencies,
  });
  return { result, calls: dependencies.calls };
}

async function withTraceEnvironment(tracePath, callback) {
  const previousTrace = process.env.M6E_D_TRACE;
  const previousPath = process.env.M6E_D_TRACE_PATH;
  process.env.M6E_D_TRACE = "1";
  if (tracePath === undefined) delete process.env.M6E_D_TRACE_PATH;
  else process.env.M6E_D_TRACE_PATH = tracePath;
  try {
    return await callback();
  } finally {
    if (previousTrace === undefined) delete process.env.M6E_D_TRACE;
    else process.env.M6E_D_TRACE = previousTrace;
    if (previousPath === undefined) delete process.env.M6E_D_TRACE_PATH;
    else process.env.M6E_D_TRACE_PATH = previousPath;
  }
}

async function readSingleTrace(tracePath) {
  const lines = (await fs.readFile(tracePath, "utf8")).trim().split(/\r?\n/u).filter(Boolean);
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0]);
}

test("M6E_D_TRACE_PATH keeps the product contract unchanged and writes no file when unset", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-d-trace-"));
  const absentPath = path.join(directory, "absent.jsonl");
  try {
    const { result, calls } = await withTraceEnvironment(undefined, () => runFixture(undefined));
    const contract = toResultContract(result, RESULT_METADATA);
    assert.equal(contract.terminalState, "SUCCESS");
    assert.equal(Object.hasOwn(contract, "d_trace"), false);
    assert.equal(calls.filter((call) => call.name === "search_decisions").length, 4);
    await assert.rejects(fs.access(absentPath));

    const tracePath = path.join(directory, "enabled.jsonl");
    const traced = await withTraceEnvironment(tracePath, () => runFixture(tracePath));
    const tracedContract = toResultContract(traced.result, RESULT_METADATA);
    assert.deepEqual(Object.keys(tracedContract).sort(), Object.keys(contract).sort());
    assert.equal(tracedContract.terminalState, contract.terminalState);
    assert.equal(Object.hasOwn(tracedContract, "d_trace"), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("M6E_D_TRACE_PATH records actual queries, raw candidates, and pre-candidateMax ranking", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-d-trace-"));
  const tracePath = path.join(directory, "diagnostic.jsonl");
  try {
    await withTraceEnvironment(tracePath, () => runFixture(tracePath));
    const trace = await readSingleTrace(tracePath);
    assert.equal(trace.schema_version, "m6e-d-diagnostic-v1");
    assert.deepEqual(trace.plan.queries, [
      { query: "generic phrase", domain: "precedent", kind: "support" },
      { query: "specific phrase", domain: "constitutional", kind: "anchor" },
      { query: "specific phrase", domain: "precedent", kind: "support" },
      { query: "anchor phrase", domain: "constitutional", kind: "anchor" },
    ]);
    assert.deepEqual(trace.plan.law_names, []);
    assert.equal(trace.search_queries.length, 4);
    assert.deepEqual(trace.search_queries.map((entry) => entry.query), [
      "generic phrase", "specific phrase", "specific phrase", "anchor phrase",
    ]);
    assert.deepEqual(trace.search_queries.map((entry) => entry.kind), ["support", "anchor", "support", "anchor"]);
    assert.equal(trace.search_queries[0].result_count, 21);
    assert.equal(trace.search_queries[0].result_case_numbers.length, 21);
    assert.equal(trace.raw_candidates.length, 21);
    assert.equal(trace.raw_candidates[0].matchedQueries.length, 4);
    assert.equal(trace.raw_candidates[0].bestQueryKind, "anchor");
    assert.equal(trace.raw_candidates[0].bestProviderRank, 1);
    assert.equal(trace.raw_candidates[0].distinctQueryCount, 4);
    assert.equal(trace.initial_ranked_before_candidate_max.length, 21);
    assert.equal(trace.initial_ranked_candidates.length, 20);
    assert.equal(trace.preview_candidates.length, 20);
    assert.equal(trace.final_ranked_candidates.length, 20);
    assert.deepEqual(trace.selected, [{ caseNumber: "2024다00001", match: "direct" }]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("diagnostic trace write failures do not fail product search", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-d-trace-"));
  try {
    const { result } = await withTraceEnvironment(directory, () => runFixture(directory));
    const contract = toResultContract(result, RESULT_METADATA);
    assert.equal(contract.terminalState, "SUCCESS");
    assert.equal(contract.items.length, 1);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
