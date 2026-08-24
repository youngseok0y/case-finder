import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger, parseProviderCompoundCaseNumber } from "../src/aoV2/evidenceLedger.js";
import { finalizeSelection } from "../src/aoV2/finalSelectionGate.js";
import { createLegalToolGateway, LEGAL_TOOL_NAMES } from "../src/aoV2/legalToolGateway.js";
import { caseNumberMatches } from "../src/router.js";

function verifiedLedger() {
  const ledger = createEvidenceLedger({ provider: "core-trust" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "fixture",
    items: [{ id: "d1", caseNumber: "2020다1234" }],
  });
  ledger.recordDecisionDetail({
    domain: "precedent",
    id: "d1",
    caseNumber: "2020다1234",
    rawText: "provider decision text",
  });
  return ledger;
}

test("final selection allows only observed and detail-verified cases", () => {
  const ledger = verifiedLedger();
  const accepted = finalizeSelection({ intro: "", selected: [{ case_no: "2020다1234", match: "direct" }] }, ledger);
  const unobserved = finalizeSelection({ intro: "", selected: [{ case_no: "2020다9999", match: "direct" }] }, ledger);

  assert.deepEqual(accepted.selected.map((item) => item.case_no), ["2020다1234"]);
  assert.equal(unobserved.rejectedSelected[0].reason, "CASE_NOT_OBSERVED");
});

test("unverified detail cannot enter the final result", () => {
  const ledger = createEvidenceLedger({ provider: "core-trust-unverified" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "fixture",
    items: [{ id: "d2", caseNumber: "2021다2345" }],
  });
  const result = finalizeSelection({ intro: "", selected: [{ case_no: "2021다2345", match: "related" }] }, ledger);
  assert.equal(result.selected.length, 0);
  assert.equal(result.rejectedSelected[0].reason, "NOT_DETAIL_VERIFIED");
});

test("compound identities remain provider-bound and two-digit years are not expanded", () => {
  const parsed = parseProviderCompoundCaseNumber("2014두12598, 12604");
  assert.deepEqual(parsed.canonicalMembers, ["2014두12598", "2014두12604"]);
  assert.equal(caseNumberMatches("2014두12598, 12604", "2014두12604"), true);
  assert.equal(caseNumberMatches("99두963", "1999두963"), false);
});

test("restricted legal MCP surface contains exactly the four allowed tools", () => {
  const gateway = createLegalToolGateway();
  assert.deepEqual(gateway.toolNames(), [...LEGAL_TOOL_NAMES]);
  assert.deepEqual(LEGAL_TOOL_NAMES, [
    "search_decisions",
    "search_law",
    "get_decision_text",
    "get_law_text",
  ]);
});

test("definitive NOT_FOUND search remains an error but records a completed search trace", async () => {
  const ledger = createEvidenceLedger({ provider: "not-found-trace" });
  const gateway = createLegalToolGateway({
    ledger,
    callTool: async () => ({ isError: true, content: [{ type: "text", text: "[NOT_FOUND]" }] }),
  });

  const result = await gateway.execute("search_decisions", { domain: "precedent", query: "not found fixture" });

  assert.equal(result.isError, true);
  assert.equal(result.notFound, true);
  assert.equal(result.hallucinationDetected, false);
  assert.equal(result.searchCompleted, true);
  assert.equal(ledger.snapshot().searchTraces.length, 1);
});
