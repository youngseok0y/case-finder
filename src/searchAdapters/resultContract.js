export const RESULT_CONTRACT_VERSION = "m9-result-contract-v1";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function selectedItems(result) {
  return (Array.isArray(result?.selected) ? result.selected : []).map((item) => ({
    caseNumber: text(item?.caseNumber || item?.case_no),
    match: text(item?.match),
  })).filter((item) => item.caseNumber);
}

export function toResultContract(result = {}, metadata = {}) {
  const selected = selectedItems(result);
  const items = Array.isArray(result.items) ? result.items : [];
  const telemetry = result.telemetry || result.metrics || result.agent_metrics || null;
  return {
    contract_version: RESULT_CONTRACT_VERSION,
    adapter_id: text(metadata.adapterId || result.adapter_id),
    provider: text(metadata.provider || result.provider),
    architecture: text(metadata.architecture || result.architecture),
    route: text(result.route) || "natural",
    query: text(result.query),
    intro: text(result.intro),
    selected,
    items,
    candidate_case_numbers: Array.isArray(result.candidateCaseNumbers) ? [...result.candidateCaseNumbers] : [],
    law_references: Array.isArray(result.lawReferences) ? [...result.lawReferences] : [],
    output_valid: result.output_valid === undefined ? true : result.output_valid === true,
    model_protocol_clean: result.model_protocol_clean === undefined ? null : result.model_protocol_clean === true,
    selection_repaired: result.selection_repaired === undefined ? null : result.selection_repaired === true,
    protocol_diagnostics: Array.isArray(result.protocolDiagnostics) ? [...result.protocolDiagnostics] : [],
    rejected_selected: Array.isArray(result.rejectedSelected) ? [...result.rejectedSelected] : [],
    telemetry,
    error: text(result.error),
  };
}

export function assertResultContract(result) {
  if (!result || result.contract_version !== RESULT_CONTRACT_VERSION) throw new Error("M9_RESULT_CONTRACT_VERSION_INVALID");
  if (!result.adapter_id || !result.provider || !result.architecture) throw new Error("M9_RESULT_CONTRACT_METADATA_INVALID");
  if (!Array.isArray(result.selected) || !Array.isArray(result.items)) throw new Error("M9_RESULT_CONTRACT_SELECTION_INVALID");
  if (typeof result.output_valid !== "boolean") throw new Error("M9_RESULT_CONTRACT_OUTPUT_VALID_INVALID");
  return result;
}
