export class AoV2Telemetry {
  constructor({ provider, model = "", reasoningEffort = null, sessionId = null, questionScopeId = null } = {}) {
    this.data = {
      provider: provider || "unknown",
      architecture: "AO_V2",
      model_calls_or_session_turns: 0,
      legal_tool_calls: 0,
      search_calls: 0,
      detail_calls: 0,
      observed_cases: 0,
      verified_cases: 0,
      unverified_selection_attempts: 0,
      empty_query_rejections: 0,
      input_tokens: 0,
      cached_input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: provider === "codex_luna" ? 0 : null,
      elapsed_ms: 0,
      stop_reason: "",
      protocol_pass: true,
      output_valid: true,
      model_protocol_clean: true,
      selection_repaired: false,
      selection_repair_reasons: [],
      model,
      reasoning_effort: reasoningEffort,
      session_id: sessionId,
      question_scope_id: questionScopeId,
      forbidden_tool_contamination: 0,
      tool_errors: 0,
    };
  }

  setSessionId(sessionId) {
    this.data.session_id = sessionId || null;
  }

  setQuestionScopeId(scopeId) {
    this.data.question_scope_id = scopeId || null;
  }

  recordModelTurn({ usage = {}, elapsedMs = 0 } = {}) {
    this.data.model_calls_or_session_turns += 1;
    this.data.input_tokens += Number(usage.input_tokens ?? usage.promptTokenCount ?? usage.inputTokenCount ?? 0);
    this.data.cached_input_tokens += Number(usage.cached_input_tokens ?? usage.cachedInputTokenCount ?? 0);
    this.data.output_tokens += Number(usage.output_tokens ?? usage.candidatesTokenCount ?? usage.outputTokenCount ?? 0);
    if (this.data.reasoning_tokens !== null) {
      this.data.reasoning_tokens += Number(usage.reasoning_tokens ?? usage.reasoning_output_tokens ?? 0);
    }
    this.data.elapsed_ms += Number(elapsedMs || 0);
  }

  recordToolCall(name, { rejected = false, errorCode = "" } = {}) {
    if (rejected) {
      if (errorCode === "EMPTY_QUERY_REJECTED") this.data.empty_query_rejections += 1;
      if (errorCode === "FORBIDDEN_TOOL") this.data.forbidden_tool_contamination += 1;
      if (errorCode) this.data.tool_errors += 1;
      return;
    }
    this.data.legal_tool_calls += 1;
    if (name === "search_decisions" || name === "search_law") this.data.search_calls += 1;
    if (name === "get_decision_text" || name === "get_law_text") this.data.detail_calls += 1;
  }

  recordSelectionGate({ rejectedSelected = [], output_valid = true, model_protocol_clean = true, selection_repaired = false, selectionRepairReasons = [] } = {}) {
    this.data.unverified_selection_attempts += rejectedSelected.filter((item) => item.reason === "NOT_DETAIL_VERIFIED").length;
    this.data.output_valid = Boolean(output_valid);
    this.data.model_protocol_clean = Boolean(model_protocol_clean);
    this.data.selection_repaired = Boolean(selection_repaired);
    this.data.selection_repair_reasons = Array.isArray(selectionRepairReasons) ? [...selectionRepairReasons] : [];
    this.data.protocol_pass = this.data.output_valid && this.data.model_protocol_clean;
  }

  setStopReason(reason) {
    this.data.stop_reason = reason || "";
  }

  markProtocolInvalid({ outputValid = false, modelProtocolClean = false, selectionRepaired = false } = {}) {
    this.data.protocol_pass = false;
    this.data.output_valid = Boolean(outputValid);
    this.data.model_protocol_clean = Boolean(modelProtocolClean);
    this.data.selection_repaired = Boolean(selectionRepaired);
  }

  snapshot(ledger = null) {
    const next = { ...this.data };
    if (ledger) {
      next.observed_cases = ledger.snapshot().cases.filter((item) => item.discovered).length;
      next.verified_cases = ledger.snapshot().cases.filter((item) => item.detailVerified).length;
    }
    return next;
  }
}

export function createTelemetry(options) {
  return new AoV2Telemetry(options);
}
