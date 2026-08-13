import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";

test("EvidenceLedger enforces search then verified detail eligibility", () => {
  const ledger = createEvidenceLedger({ provider: "test" });
  ledger.recordDecisionSearch({ query: "계약", domain: "precedent", items: [{ id: "d1", caseNumber: "2020다1234" }] });
  assert.equal(ledger.isFinalEligible("2020다1234"), false);
  assert.equal(ledger.isDecisionIdObserved("precedent", "d1"), true);
  const detail = ledger.recordDecisionDetail({
    domain: "precedent",
    id: "d1",
    caseNumber: "2020다1234",
    rawText: "원문",
    detail: { sections: { 판시사항: "내용" } },
  });
  assert.equal(detail.verified, true);
  assert.equal(ledger.isFinalEligible("2020다1234"), true);
});

test("EvidenceLedger rejects unobserved detail and keeps law registry separate", () => {
  const ledger = createEvidenceLedger({ provider: "test" });
  const detail = ledger.recordDecisionDetail({ domain: "precedent", id: "unknown", caseNumber: "2020다1234", rawText: "원문" });
  assert.equal(detail.reason, "SEARCH_NOT_OBSERVED");
  ledger.recordLawSearch({ query: "민법", items: [{ lawId: "L1", mst: "M1", title: "민법" }] });
  assert.equal(ledger.isLawObserved({ mst: "M1" }), true);
  assert.equal(ledger.recordLawText({ mst: "M1" }).verified, true);
  assert.equal(ledger.snapshot().cases.length, 0);
});
