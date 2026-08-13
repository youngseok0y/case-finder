import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { finalizeSelection } from "../src/aoV2/finalSelectionGate.js";

test("compound identity accepts verified provider members and rejects invented siblings", () => {
  const ledger = createEvidenceLedger({ provider: "product_compound_identity" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "compound fixture",
    items: [{ id: "compound-1", caseNumber: "2014두12598" }],
  });
  ledger.recordDecisionDetail({
    domain: "precedent",
    id: "compound-1",
    caseNumber: "2014두12598, 12604",
    rawText: "provider raw detail",
  });
  const recovered = finalizeSelection({ intro: "", selected: [{ case_no: "2014두12598", match: "direct" }] }, ledger);
  const rejected = finalizeSelection({ intro: "", selected: [{ case_no: "2014두99999", match: "direct" }] }, ledger);
  assert.deepEqual(recovered.selected.map((item) => item.case_no), ["2014두12598"]);
  assert.equal(rejected.rejectedSelected[0]?.reason, "CASE_NOT_OBSERVED");
});
