import { extractCaseNumbers, normalizeCaseNumber } from "../router.js";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function finalizeSelection(selection, ledger, { resultMax = 5 } = {}) {
  const selected = Array.isArray(selection?.selected) ? selection.selected : [];
  const selectionShapeValid = Array.isArray(selection?.selected) && typeof selection?.intro === "string";
  const rejectedSelected = [];
  const eligibleSelected = [];
  const seen = new Set();

  for (const item of selected.slice(0, resultMax)) {
    const caseNumber = normalizeCaseNumber(text(item?.case_no || item?.caseNumber));
    const match = text(item?.match);
    if (!caseNumber) {
      rejectedSelected.push({ case_no: text(item?.case_no || item?.caseNumber), match, reason: "INVALID_CASE_NUMBER" });
      continue;
    }
    if (match !== "direct" && match !== "related") {
      rejectedSelected.push({ case_no: caseNumber, match, reason: "INVALID_MATCH" });
      continue;
    }
    const candidate = ledger.getCase(caseNumber);
    if (!candidate) {
      rejectedSelected.push({ case_no: caseNumber, match, reason: "CASE_NOT_OBSERVED" });
      continue;
    }
    if (!candidate.detailVerified) {
      rejectedSelected.push({ case_no: candidate.caseNumber, match, reason: "NOT_DETAIL_VERIFIED" });
      continue;
    }
    if (seen.has(candidate.caseKey)) {
      rejectedSelected.push({ case_no: candidate.caseNumber, match, reason: "DUPLICATE_CASE" });
      continue;
    }
    seen.add(candidate.caseKey);
    eligibleSelected.push({ case_no: candidate.caseNumber, match });
  }

  ledger.recordSelectionAttempt(selection);
  const protocolDiagnostics = rejectedSelected.map((item) => ({
    code: item.reason === "NOT_DETAIL_VERIFIED" ? "MODEL_UNVERIFIED_SELECTION_ATTEMPT" : item.reason,
    case_no: item.case_no,
  }));
  let intro = text(selection?.intro);
  const introRemoved = Boolean(intro && extractCaseNumbers(intro).length > 0);
  if (introRemoved) {
    intro = "";
    protocolDiagnostics.push({ code: "INTRO_CASE_NUMBER_REMOVED" });
  }
  const selectionRepaired = !selectionShapeValid || rejectedSelected.length > 0 || introRemoved || selected.length > resultMax;
  const outputValid = true;
  const modelProtocolClean = selectionShapeValid && rejectedSelected.length === 0 && !introRemoved && selected.length <= resultMax;
  if (selected.length > resultMax) protocolDiagnostics.push({ code: "RESULT_MAX_TRUNCATED" });
  return {
    selected: eligibleSelected,
    intro,
    rejectedSelected,
    protocolDiagnostics,
    output_valid: outputValid,
    model_protocol_clean: modelProtocolClean,
    selection_repaired: selectionRepaired,
    protocolPass: outputValid && modelProtocolClean,
  };
}

export function createFinalSelectionGate({ ledger, resultMax = 5 } = {}) {
  if (!ledger) throw new Error("FINAL_SELECTION_GATE_LEDGER_REQUIRED");
  return {
    finalize(selection) {
      return finalizeSelection(selection, ledger, { resultMax });
    },
  };
}

export const FinalSelectionGate = Object.freeze({ finalizeSelection });
