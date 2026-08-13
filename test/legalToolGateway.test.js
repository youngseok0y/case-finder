import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { createLegalToolGateway } from "../src/aoV2/legalToolGateway.js";
import { createSafetyController } from "../src/aoV2/safety.js";
import { createTelemetry } from "../src/aoV2/telemetry.js";

function fixtureGateway() {
  const calls = [];
  const ledger = createEvidenceLedger({ provider: "test" });
  const telemetry = createTelemetry({ provider: "test" });
  const gateway = createLegalToolGateway({
    ledger,
    telemetry,
    safety: createSafetyController({ legalToolMax: 20 }),
    callTool: async (name, args) => {
      calls.push({ name, args });
      return { name, args };
    },
    normalizeResult: async (name) => {
      if (name === "search_decisions") return { isError: false, items: [{ id: "d1", caseNumber: "2020다1234", title: "fixture" }], rawText: "search" };
      if (name === "get_decision_text") return { isError: false, caseNumber: "2020다1234", rawText: "verified decision", sections: {} };
      if (name === "search_law") return { isError: false, items: [{ lawId: "L1", mst: "M1", title: "민법" }], rawText: "law search" };
      return { isError: false, rawText: "law text" };
    },
  });
  return { calls, ledger, telemetry, gateway };
}

test("LegalToolGateway rejects empty queries without calling MCP", async () => {
  const { calls, gateway } = fixtureGateway();
  const result = await gateway.execute("search_decisions", { domain: "precedent", query: "   " });
  assert.equal(result.isError, true);
  assert.equal(result.code, "EMPTY_QUERY_REJECTED");
  assert.equal(calls.length, 0);
});

test("LegalToolGateway applies precedent search=2 and detail full=false", async () => {
  const { calls, gateway } = fixtureGateway();
  await gateway.execute("search_decisions", { domain: "precedent", query: "계약" });
  const detail = await gateway.execute("get_decision_text", { domain: "precedent", id: "d1" });
  assert.equal(detail.isError, false);
  assert.deepEqual(calls[0].args.options, { search: 2 });
  assert.equal(calls[1].args.full, false);
  assert.equal(calls[1].args.id, "d1");
});

test("LegalToolGateway rejects unobserved detail and law identifiers", async () => {
  const { calls, gateway } = fixtureGateway();
  const decision = await gateway.execute("get_decision_text", { domain: "precedent", id: "unknown" });
  const law = await gateway.execute("get_law_text", { mst: "unknown" });
  assert.equal(decision.code, "UNOBSERVED_DETAIL_REJECTED");
  assert.equal(law.code, "UNOBSERVED_DETAIL_REJECTED");
  assert.equal(calls.length, 0);
});

test("LegalToolGateway records law evidence before allowing law text", async () => {
  const { gateway, ledger } = fixtureGateway();
  await gateway.execute("search_law", { query: "민법" });
  const result = await gateway.execute("get_law_text", { mst: "M1" });
  assert.equal(result.isError, false);
  assert.equal(ledger.snapshot().laws[0].textOpened, true);
});

test("LegalToolGateway blocks tools outside the restricted legal surface", async () => {
  const { gateway, telemetry } = fixtureGateway();
  const result = await gateway.execute("command_execution", {});
  assert.equal(result.code, "FORBIDDEN_TOOL");
  assert.equal(telemetry.snapshot().forbidden_tool_contamination, 1);
});
