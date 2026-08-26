import assert from "node:assert/strict";
import test from "node:test";
import { createCodexNativeAo } from "../src/aoV2/providers/codexNativeAo.js";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { createLegalToolGateway } from "../src/aoV2/legalToolGateway.js";
import { buildLunaResultItems, createLunaNativeAdapter } from "../src/searchAdapters/lunaNativeAdapter.js";
import { toResultContract } from "../src/searchAdapters/resultContract.js";

const RESULT_METADATA = {
  adapterId: "luna_native",
  provider: "codex_luna",
  architecture: "AO_V2_NATIVE",
};

function fixtureSession(events, onEvent) {
  return async () => {
    let index = 0;
    return {
      async next() {
        const entry = events[index++];
        if (!entry) return null;
        onEvent(entry);
        return entry.event;
      },
      async respondToToolCall() {},
      async close() {},
    };
  };
}

function createFixtureAo(events) {
  const ledger = createEvidenceLedger({ provider: "ao-integrity-fixture" });
  let currentEntry = null;
  const gateway = createLegalToolGateway({
    ledger,
    callTool: async () => currentEntry?.result || {},
  });
  const ao = createCodexNativeAo({
    gateway,
    ledger,
    createSession: fixtureSession(events, (entry) => { currentEntry = entry; }),
  });
  return { ao, ledger };
}

function searchEvent({ name = "search_decisions", args = {}, result = { items: [] } } = {}) {
  return {
    event: { type: "mcp_tool_call", delegated: false, name, arguments: args, call_id: `${name}-1` },
    result,
  };
}

test("delegated tool results fail closed without callback ingestion", async () => {
  const ledger = createEvidenceLedger({ provider: "delegated-boundary-fixture" });
  let callbackProvided = false;
  const gateway = createLegalToolGateway({
    ledger,
    callTool: async () => ({ items: [] }),
  });
  const ao = createCodexNativeAo({
    gateway,
    ledger,
    createSession: async (options) => {
      callbackProvided = Object.prototype.hasOwnProperty.call(options, "onDelegatedToolResult");
      return {
        async next() {
          return { type: "mcp_tool_call", delegated: true, name: "search_decisions", arguments: {}, call_id: "delegated-1" };
        },
        async close() {},
      };
    },
  });
  const result = await ao.run("delegated result fixture");

  assert.equal(callbackProvided, false);
  assert.equal(result.output_valid, false);
  assert.equal(result.protocolDiagnostics[0].code, "AO_V2_UNLEDGERED_TOOL_RESULT");
  assert.equal(ledger.snapshot().searchTraces.length, 0);
});

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
    searchEvent({
      args: { domain: "precedent", query: "not found fixture" },
      result: { isError: true, content: [{ type: "text", text: "[NOT_FOUND]" }] },
    }),
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

test("empty or invalid search responses do not produce NO_RESULT", async () => {
  for (const result of [{}, { content: [] }]) {
    const { ao } = createFixtureAo([
      searchEvent({ result }),
      { event: { type: "final", selection: { selected: [], intro: "" } } },
    ]);
    const final = await ao.run("invalid search fixture");
    const contract = toResultContract(final, RESULT_METADATA);
    assert.equal(final.output_valid, false);
    assert.equal(final.protocolDiagnostics[0].code, "AO_V2_SEARCH_REQUIRED");
    assert.notEqual(contract.terminalState, "NO_RESULT");
  }
});

test("search_law alone cannot satisfy the precedent search requirement", async () => {
  const { ao } = createFixtureAo([
    searchEvent({ name: "search_law", args: { query: "민법" }, result: { items: [] } }),
    { event: { type: "final", selection: { selected: [], intro: "" } } },
  ]);
  const result = await ao.run("law-only fixture");
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
      result: { content: [{ type: "text", text: "[1] fixture\n사건번호: 2020다1234" }] },
    }),
    {
      event: { type: "mcp_tool_call", delegated: false, name: "get_decision_text", arguments: { domain: "precedent", id: "1" }, call_id: "detail-1" },
      result: { content: [{ type: "text", text: "사건번호: 2020다1234\n판결요지: verified provider decision text" }] },
    },
    { event: { type: "final", selection: { selected: [{ case_no: "2020다1234", match: "direct" }], intro: "" } } },
  ]);
  const result = await ao.run("verified fixture");
  const contract = toResultContract({ ...result, items: buildLunaResultItems(result, ledger) }, RESULT_METADATA);

  assert.equal(ledger.getCase("2020다1234").detailVerified, true);
  assert.deepEqual(contract.selected, [{ caseNumber: "2020다1234", match: "direct" }]);
  assert.equal(contract.terminalState, "SUCCESS");
});

test("Luna adapter does not expose unverified items on the NO_RESULT boundary", async () => {
  const ledger = createEvidenceLedger({ provider: "no-result-boundary-fixture" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "unverified fixture",
    items: [{ id: "case-2", caseNumber: "2020다5678" }],
  });
  assert.deepEqual(buildLunaResultItems({
    selected: [{ case_no: "2020다5678", match: "direct" }],
  }, ledger), []);

  const adapter = createLunaNativeAdapter({
    run: async () => ({
      selected: [{ case_no: "2020다5678", match: "direct" }],
      items: [{ status: "validation_failed", caseNumber: "2020다5678" }],
      candidateCaseNumbers: ["2020다5678"],
    }),
  });
  const result = await adapter.runNaturalQuery("unverified fixture");
  assert.deepEqual(result.items, []);
  assert.equal(result.terminalState, "NO_RESULT");
});

test("forbidden tool remains blocked before final selection", async () => {
  const { ao } = createFixtureAo([
    { event: { type: "tool_call", name: "shell", arguments: {} } },
  ]);
  const result = await ao.run("forbidden tool fixture");

  assert.equal(result.output_valid, false);
  assert.equal(result.protocolDiagnostics[0].code, "AO_V2_LUNA_TOOL_CONTAMINATION");
});
