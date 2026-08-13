import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { finalizeSelection } from "../src/aoV2/finalSelectionGate.js";
import { createTelemetry } from "../src/aoV2/telemetry.js";

function ledgerWithCases() {
  const ledger = createEvidenceLedger({ provider: "test" });
  ledger.recordDecisionSearch({
    query: "fixture",
    domain: "precedent",
    items: [
      { id: "verified", caseNumber: "2020다1234" },
      { id: "unverified", caseNumber: "2021다5678" },
    ],
  });
  ledger.recordDecisionDetail({ domain: "precedent", id: "verified", caseNumber: "2020다1234", rawText: "원문" });
  return ledger;
}

test("FinalSelectionGate preserves verified selection and rejects unverified extra", () => {
  const result = finalizeSelection({
    selected: [
      { case_no: "2020다1234", match: "direct" },
      { case_no: "2021다5678", match: "related" },
    ],
    intro: "설명",
  }, ledgerWithCases());
  assert.deepEqual(result.selected, [{ case_no: "2020다1234", match: "direct" }]);
  assert.equal(result.rejectedSelected[0].reason, "NOT_DETAIL_VERIFIED");
  assert.equal(result.protocolDiagnostics[0].code, "MODEL_UNVERIFIED_SELECTION_ATTEMPT");
  assert.equal(result.output_valid, true);
  assert.equal(result.model_protocol_clean, false);
  assert.equal(result.selection_repaired, true);
  assert.equal(result.protocolPass, false);
  const telemetry = createTelemetry({ provider: "codex_luna" });
  telemetry.recordSelectionGate(result);
  assert.deepEqual(
    (({ output_valid, model_protocol_clean, selection_repaired, protocol_pass }) => ({ output_valid, model_protocol_clean, selection_repaired, protocol_pass }))(telemetry.snapshot()),
    { output_valid: true, model_protocol_clean: false, selection_repaired: true, protocol_pass: false },
  );
});

test("FinalSelectionGate dedupes and removes case numbers from intro", () => {
  const result = finalizeSelection({
    selected: [
      { case_no: "2020다1234", match: "direct" },
      { case_no: "2020다1234", match: "related" },
      { case_no: "2022다9999", match: "direct" },
    ],
    intro: "2020다1234 관련 설명",
  }, ledgerWithCases());
  assert.equal(result.selected.length, 1);
  assert.equal(result.rejectedSelected.some((item) => item.reason === "DUPLICATE_CASE"), true);
  assert.equal(result.rejectedSelected.some((item) => item.reason === "CASE_NOT_OBSERVED"), true);
  assert.equal(result.intro, "");
  assert.equal(result.protocolDiagnostics.some((item) => item.code === "INTRO_CASE_NUMBER_REMOVED"), true);
});
