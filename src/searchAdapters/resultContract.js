import { text } from "../text.js";

export const RESULT_CONTRACT_VERSION = "m9-result-contract-v1";

const SNAKE_CASE_FIELDS = Object.freeze([
  "contract_version",
  "adapter_id",
  "candidate_case_numbers",
  "law_references",
  "validation_failures",
  "fallback_label",
  "output_valid",
  "model_protocol_clean",
  "selection_repaired",
  "protocol_diagnostics",
  "rejected_selected",
  "execution_pin",
]);

function arrayOr(value, fallback = []) {
  return Array.isArray(value) ? [...value] : fallback;
}

function firstArray(...values) {
  const value = values.find((candidate) => Array.isArray(candidate));
  return value ? [...value] : [];
}

function nullableBoolean(canonicalValue, legacyValue) {
  const value = canonicalValue === undefined ? legacyValue : canonicalValue;
  return value === undefined || value === null ? null : value === true;
}

function selectedItems(result) {
  return (Array.isArray(result?.selected) ? result.selected : []).map((item) => ({
    caseNumber: text(item?.caseNumber || item?.case_no),
    match: text(item?.match),
  })).filter((item) => item.caseNumber);
}

function executionPin(result, metadata) {
  return metadata.executionPin || result.executionPin || result.execution_pin || null;
}

function modelResolution(result) {
  const value = result.modelResolution || result.model_resolution;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    requestedModel: text(value.requestedModel || value.requested_model),
    effectiveModel: text(value.effectiveModel || value.effective_model),
    fallbackApplied: value.fallbackApplied === true || value.fallback_applied === true,
  };
}

export function deriveTerminalState(result, outputValid, items) {
  if (!outputValid) return "SAFETY_REJECTED";
  if (result.error) return "SEARCH_FAILED";
  if (Array.isArray(result.validationFailures) && result.validationFailures.length > 0) {
    return items.length > 0 ? "PARTIAL_VERIFIED" : "SEARCH_FAILED";
  }
  return items.length > 0 ? "SUCCESS" : "NO_RESULT";
}

/**
 * Normalize an adapter/pipeline result into the one canonical Node-side
 * product contract. Upstream AO-v2 and legacy pipeline fields may still be
 * snake_case, but the returned product object never contains snake_case
 * aliases or duplicate fields.
 */
export function toResultContract(result = {}, metadata = {}) {
  const selected = selectedItems(result);
  const items = arrayOr(result.items);
  const validationFailures = firstArray(result.validationFailures, result.validation_failures);
  const outputValid = result.outputValid === undefined
    ? (result.output_valid === undefined ? true : result.output_valid === true)
    : result.outputValid === true;
  const telemetry = result.telemetry || result.metrics || result.agent_metrics || null;
  const contract = {
    contractVersion: RESULT_CONTRACT_VERSION,
    adapterId: text(metadata.adapterId || result.adapterId || result.adapter_id),
    provider: text(metadata.provider || result.provider),
    architecture: text(metadata.architecture || result.architecture),
    route: text(result.route) || "natural",
    query: text(result.query),
    intro: text(result.intro),
    selected,
    items,
    candidateCaseNumbers: firstArray(result.candidateCaseNumbers, result.candidate_case_numbers),
    lawReferences: firstArray(result.lawReferences, result.law_references),
    validationFailures,
    fallbackLabel: text(result.fallbackLabel || result.fallback_label),
    outputValid,
    modelProtocolClean: nullableBoolean(result.modelProtocolClean, result.model_protocol_clean),
    selectionRepaired: nullableBoolean(result.selectionRepaired, result.selection_repaired),
    protocolDiagnostics: arrayOr(result.protocolDiagnostics || result.protocol_diagnostics),
    rejectedSelected: arrayOr(result.rejectedSelected || result.rejected_selected),
    executionPin: executionPin(result, metadata),
    modelResolution: modelResolution(result),
    telemetry,
    terminalState: deriveTerminalState({ ...result, validationFailures }, outputValid, items),
    error: text(result.error),
  };
  assertResultContract(contract);
  return contract;
}

export function assertResultContract(result) {
  if (!result || result.contractVersion !== RESULT_CONTRACT_VERSION) throw new Error("M9_RESULT_CONTRACT_VERSION_INVALID");
  if (!result.adapterId || !result.provider || !result.architecture) throw new Error("M9_RESULT_CONTRACT_METADATA_INVALID");
  if (!Array.isArray(result.selected) || !Array.isArray(result.items)) throw new Error("M9_RESULT_CONTRACT_SELECTION_INVALID");
  if (!Array.isArray(result.candidateCaseNumbers) || !Array.isArray(result.lawReferences)) throw new Error("M9_RESULT_CONTRACT_EVIDENCE_INVALID");
  if (typeof result.outputValid !== "boolean") throw new Error("M9_RESULT_CONTRACT_OUTPUT_VALID_INVALID");
  for (const field of SNAKE_CASE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(result, field)) throw new Error(`M9_RESULT_CONTRACT_AMBIGUOUS:${field}`);
  }
  return result;
}
