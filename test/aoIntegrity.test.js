import assert from "node:assert/strict";
import test from "node:test";
import { createCodexNativeAo } from "../src/aoV2/providers/codexNativeAo.js";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { buildLunaResultItems } from "../src/searchAdapters/lunaNativeAdapter.js";
import { toResultContract } from "../src/searchAdapters/resultContract.js";

const RESULT_METADATA = {
  adapterId: "luna_native",
  provider: "codex_luna",
  architecture: "AO_V2_NATIVE",
};

function delegatedSession(events) {
  return async ({ onDelegatedToolResult }) => {
    let index = 0;
    return {
      async next() {
        const entry = events[index++];
        if (!entry) return null;
        if (entry.delegatedResult) onDelegatedToolResult(entry.delegatedResult);
        return entry.event;
      },
      async close() {},
    };
  };
}

function createFixtureAo(events) {
  const ledger = createEvidenceLedger({ provider: "ao-integrity-fixture" });
  const ao = createCodexNativeAo({
    gateway: { ledger, execute: async () => ({}) },
    ledger,
    createSession: delegatedSession(events),
  });
  return { ao, ledger };
}

function searchEvent({ name = "search_decisions", args = {}, result = { items: [] } } = {}) {
  return {
    event: { type: "mcp_tool_call", delegated: true, name, arguments: args, call_id: `${name}-1` },
    delegatedResult: { name, arguments: args, result },
  };
}

test("zero-search empty final is a protocol failure, not NO_RESULT", async () => {
  const { ao } = createFixtureAo([
    { event: { type: "final", selection: { selected: [], intro: "" } } },
  ]);
  const result = await ao.run("zero search fixture");
  const contract = toResultContract(result, RESULT_METADATA);

  assert.equal(result.output_valid, false);
  assert.equal(result.protocolDiagnostics[0].code, "AO_V2_SEARCH_REQUIRED");
  assert.equal(contract.terminalState, "SAFETY_REJECTED");
});

test("one accepted search with no results can produce NO_RESULT", async () => {
  const { ao, ledger } = createFixtureAo([
    searchEvent({ args: { domain: "precedent", query: "empty fixture" } }),
    { event: { type: "final", selection: { selected: [], intro: "" } } },
  ]);
  const result = await ao.run("empty fixture");
  const contract = toResultContract(result, RESULT_METADATA);

  assert.equal(ledger.snapshot().searchTraces.length, 1);
  assert.equal(result.output_valid, true);
  assert.equal(contract.terminalState, "NO_RESULT");
});

test("definitive NOT_FOUND search is completed and produces NO_RESULT", async () => {
  const { ao, ledger } = createFixtureAo([
    searchEvent({ result: { isError: true, rawText: "[NOT_FOUND]" } }),
    { event: { type: "final", selection: { selected: [], intro: "" } } },
  ]);
  const result = await ao.run("not found fixture");
  const contract = toResultContract(result, RESULT_METADATA);

  assert.equal(ledger.snapshot().searchTraces.length, 1);
  assert.equal(result.output_valid, true);
  assert.equal(contract.terminalState, "NO_RESULT");
});

test("hallucination search does not count as a completed search", async () => {
  const { ao } = createFixtureAo([
    searchEvent({ result: { isError: true, rawText: "[HALLUCINATION_DETECTED]" } }),
    { event: { type: "final", selection: { selected: [], intro: "" } } },
  ]);
  const result = await ao.run("hallucination fixture");
  const contract = toResultContract(result, RESULT_METADATA);

  assert.equal(result.output_valid, false);
  assert.equal(result.protocolDiagnostics[0].code, "AO_V2_SEARCH_REQUIRED");
  assert.notEqual(contract.terminalState, "NO_RESULT");
});

test("generic search error does not count as a completed search", async () => {
  const { ao } = createFixtureAo([
    searchEvent({ result: { isError: true, rawText: "provider error" } }),
    { event: { type: "final", selection: { selected: [], intro: "" } } },
  ]);
  const result = await ao.run("provider error fixture");
  const contract = toResultContract(result, RESULT_METADATA);

  assert.equal(result.output_valid, false);
  assert.equal(result.protocolDiagnostics[0].code, "AO_V2_SEARCH_REQUIRED");
  assert.notEqual(contract.terminalState, "NO_RESULT");
});

test("accepted search plus detail verification preserves successful final selection", async () => {
  const searchArgs = { domain: "precedent", query: "verified fixture" };
  const { ao, ledger } = createFixtureAo([
    searchEvent({
      args: searchArgs,
      result: { items: [{ id: "case-1", caseNumber: "2020다1234" }] },
    }),
    {
      event: { type: "mcp_tool_call", delegated: true, name: "get_decision_text", arguments: { domain: "precedent", id: "case-1" }, call_id: "detail-1" },
      delegatedResult: {
        name: "get_decision_text",
        arguments: { domain: "precedent", id: "case-1" },
        result: { caseNumber: "2020다1234", rawText: "verified provider decision text" },
      },
    },
    { event: { type: "final", selection: { selected: [{ case_no: "2020다1234", match: "direct" }], intro: "" } } },
  ]);
  const result = await ao.run("verified fixture");
  const contract = toResultContract({ ...result, items: buildLunaResultItems(result, ledger) }, RESULT_METADATA);

  assert.equal(ledger.getCase("2020다1234").detailVerified, true);
  assert.deepEqual(contract.selected, [{ caseNumber: "2020다1234", match: "direct" }]);
  assert.equal(contract.terminalState, "SUCCESS");
});

test("forbidden tool remains blocked before final selection", async () => {
  const { ao } = createFixtureAo([
    { event: { type: "tool_call", name: "shell", arguments: {} } },
  ]);
  const result = await ao.run("forbidden tool fixture");

  assert.equal(result.output_valid, false);
  assert.equal(result.protocolDiagnostics[0].code, "AO_V2_LUNA_TOOL_CONTAMINATION");
});
