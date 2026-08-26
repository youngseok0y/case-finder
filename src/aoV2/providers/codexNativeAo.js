import { config } from "../../../config.js";
import { createSafetyController } from "../safety.js";
import { createTelemetry } from "../telemetry.js";
import { createCommonEvidenceEnvelope } from "../commonEvidenceEnvelope.js";
import { LEGAL_TOOL_NAMES } from "../legalToolDefinitions.js";
import { isLunaTerraFallback, normalizeModelResolution } from "../../codexAppServerRuntime.js";

export const CODEX_NATIVE_ALLOWED_TOOLS = LEGAL_TOOL_NAMES;

const FORBIDDEN_EVENT_TYPES = new Set([
  "shell",
  "command_execution",
  "web_search",
  "browser",
  "repo_read",
  "repo_write",
  "git",
  "github",
]);

function ledgerProgress(ledger) {
  if (typeof ledger?.progressCounts === "function") return ledger.progressCounts();
  const snapshot = ledger?.snapshot?.() || { cases: [], laws: [] };
  return {
    candidateCount: snapshot.cases.filter((item) => item.discovered).length,
    verifiedCount: snapshot.cases.filter((item) => item.detailVerified).length,
    lawCount: snapshot.laws.filter((item) => item.observed).length,
    evidenceCount: snapshot.cases.length + snapshot.laws.length,
  };
}

function ledgerProgressEvent(ledger) {
  const progress = ledgerProgress(ledger);
  return {
    candidateCount: progress.candidateCount,
    verifiedCount: progress.verifiedCount,
    lawCount: progress.lawCount,
  };
}

export function buildLunaNativePrompt(query) {
  return [
    "사용자 질문:",
    query,
    "",
    "Before finalizing, you MUST call at least one approved legal MCP search tool using the user's question. Do not claim that the legal MCP tools are unavailable; they are provided in this session.",
    "허용된 legal MCP 도구만 사용하세요.",
    "search_decisions, get_decision_text, search_law, get_law_text 외의 shell, command execution, 파일/리포지토리 읽기·쓰기, web, browser, Git, GitHub 및 기타 도구는 절대 사용하지 마세요.",
    "검색 결과에서 관측한 사건만 상세 조회하고, 상세 원문 검증이 완료된 사건만 최종 선택하세요.",
    "최종 응답은 {\"selected\":[{\"case_no\":\"...\",\"match\":\"direct|related\"}],\"intro\":\"...\"} JSON입니다.",
    "intro는 자연스럽고 일관된 한국어 해요체(-해요/-이에요/-예요)로 작성하세요. 하십시오체(-습니다/-입니다), 반말, 보고서체를 섞지 마세요.",
  ].join("\n");
}

function nativeToolCall(event) {
  return event?.type === "tool_call" || event?.type === "mcp_tool_call";
}

export function createCodexNativeAo({
  gateway,
  ledger = gateway.ledger,
  telemetry = createTelemetry({ provider: "codex_luna", model: config.codexModel, reasoningEffort: config.codexReasoningEffort }),
  safety = createSafetyController(),
  createSession,
  resultMax = config.resultMax,
  envelope = null,
} = {}) {
  if (!gateway) throw new Error("CODEX_NATIVE_AO_GATEWAY_REQUIRED");
  if (typeof createSession !== "function") throw new Error("CODEX_NATIVE_SESSION_FACTORY_REQUIRED");
  const evidenceEnvelope = envelope || createCommonEvidenceEnvelope({ ledger, resultMax });

  return {
    provider: "codex_luna",
    async run(query, { onProgress = () => {}, abortSignal = null, model = config.codexModel } = {}) {
      telemetry.setQuestionScopeId(ledger.scopeId);
      const startedAt = Date.now();
      safety.assertCanContinue();
      let completedDecisionSearch = false;
      const session = await createSession({
        query,
        prompt: buildLunaNativePrompt(query),
        model,
        reasoningEffort: config.codexReasoningEffort,
        tools: CODEX_NATIVE_ALLOWED_TOOLS.map((name) => ({ name, kind: "legal", restricted: true })),
        abortSignal,
      });
      telemetry.setSessionId(session?.sessionId || session?.session_id || null);
      let closed = false;
      const abortHandler = () => {
        if (closed) return;
        closed = true;
        void session.close?.();
      };
      abortSignal?.addEventListener("abort", abortHandler, { once: true });
      try {
        while (true) {
          safety.assertCanContinue();
          const event = await session.next();
          if (!event) {
            safety.assertCanContinue();
            throw new Error("CODEX_NATIVE_SESSION_ENDED_WITHOUT_FINAL");
          }
          if (event.type === "session_timeout") throw new Error("CODEX_NATIVE_SESSION_TIMEOUT");
          if (FORBIDDEN_EVENT_TYPES.has(event.type)) {
            telemetry.recordToolCall(event.type, { rejected: true, errorCode: "FORBIDDEN_TOOL" });
            telemetry.markProtocolInvalid();
            telemetry.setStopReason("AO_V2_LUNA_TOOL_CONTAMINATION");
            return {
              provider: "codex_luna",
              architecture: "AO_V2",
              selected: [],
              intro: "",
              rejectedSelected: [],
              protocolDiagnostics: [{ code: "AO_V2_LUNA_TOOL_CONTAMINATION", type: event.type }],
              output_valid: false,
              model_protocol_clean: false,
              selection_repaired: false,
              protocolPass: false,
              ledger: ledger.snapshot(),
              telemetry: telemetry.snapshot(ledger),
              elapsed_ms: Date.now() - startedAt,
            };
          }
          if (nativeToolCall(event)) {
            const name = event.name || event.tool_name;
            if (!CODEX_NATIVE_ALLOWED_TOOLS.includes(name)) {
              telemetry.recordToolCall(name, { rejected: true, errorCode: "FORBIDDEN_TOOL" });
              telemetry.markProtocolInvalid();
              telemetry.setStopReason("AO_V2_LUNA_TOOL_CONTAMINATION");
              return {
                provider: "codex_luna",
                architecture: "AO_V2",
                selected: [],
                intro: "",
                rejectedSelected: [],
                protocolDiagnostics: [{ code: "AO_V2_LUNA_TOOL_CONTAMINATION", tool: name }],
                output_valid: false,
                model_protocol_clean: false,
                selection_repaired: false,
                protocolPass: false,
                ledger: ledger.snapshot(),
                telemetry: telemetry.snapshot(ledger),
                elapsed_ms: Date.now() - startedAt,
              };
            }
            if (event.delegated === true) {
              safety.recordLegalToolCall();
              telemetry.recordToolCall(name, { rejected: true, errorCode: "AO_V2_UNLEDGERED_TOOL_RESULT" });
              telemetry.markProtocolInvalid();
              telemetry.setStopReason("AO_V2_UNLEDGERED_TOOL_RESULT");
              return {
                provider: "codex_luna",
                architecture: "AO_V2",
                selected: [],
                intro: "",
                rejectedSelected: [],
                protocolDiagnostics: [{ code: "AO_V2_UNLEDGERED_TOOL_RESULT", tool: name }],
                output_valid: false,
                model_protocol_clean: false,
                selection_repaired: false,
                protocolPass: false,
                ledger: ledger.snapshot(),
                telemetry: telemetry.snapshot(ledger),
                elapsed_ms: Date.now() - startedAt,
              };
            }
            const result = await gateway.execute(name, event.arguments || event.args || {});
            if (name === "search_decisions" && result?.searchCompleted === true) completedDecisionSearch = true;
            if (typeof session.respondToToolCall !== "function") throw new Error("CODEX_NATIVE_SESSION_TOOL_RESPONSE_REQUIRED");
            await session.respondToToolCall({ callId: event.call_id || event.callId || null, name, result });
            continue;
          }
          if (event.type === "final") {
            const finalProgress = ledgerProgressEvent(ledger);
            onProgress("FINALIZING", {
              candidateCount: finalProgress.candidateCount,
              verifiedCount: finalProgress.verifiedCount,
              lawCount: finalProgress.lawCount,
            });
            telemetry.setSessionId(event.session_id || event.sessionId || session?.sessionId || null);
            if (event.usage || event.elapsedMs) telemetry.recordModelTurn({ usage: event.usage || {}, elapsedMs: event.elapsedMs || 0 });
            const rawModelResolution = event.modelResolution || null;
            const normalizedModelResolution = rawModelResolution
              ? normalizeModelResolution(rawModelResolution, model)
              : null;
            const modelResolution = normalizedModelResolution
              ? {
                requestedModel: normalizedModelResolution.requestedModel,
                effectiveModel: normalizedModelResolution.effectiveModel,
                fallbackApplied: normalizedModelResolution.fallbackApplied,
              }
              : null;
            if (isLunaTerraFallback(modelResolution)) {
              onProgress("MODEL_FALLBACK", {
                candidateCount: finalProgress.candidateCount,
                verifiedCount: finalProgress.verifiedCount,
                lawCount: finalProgress.lawCount,
                fallbackApplied: true,
                requestedModel: modelResolution.requestedModel,
                effectiveModel: modelResolution.effectiveModel,
              });
            }
            if (!completedDecisionSearch) {
              telemetry.markProtocolInvalid();
              telemetry.setStopReason("AO_V2_SEARCH_REQUIRED");
              return {
                provider: "codex_luna",
                architecture: "AO_V2",
                selected: [],
                intro: "",
                rejectedSelected: [],
                protocolDiagnostics: [{ code: "AO_V2_SEARCH_REQUIRED" }],
                output_valid: false,
                model_protocol_clean: false,
                selection_repaired: false,
                protocolPass: false,
                modelResolution,
                ledger: ledger.snapshot(),
                telemetry: telemetry.snapshot(ledger),
                elapsed_ms: Date.now() - startedAt,
              };
            }
            const attempt = event.selection || event.value || event;
            const gated = evidenceEnvelope.finalizeSelection(attempt);
            evidenceEnvelope.recordSelectionDiagnostic({ selection: attempt, gated, continuationCount: 0 });
            telemetry.recordSelectionGate({
              ...gated,
              selectionRepairReasons: gated.selection_repair_reasons,
            });
            telemetry.setStopReason("MODEL_FINAL");
            return {
              provider: "codex_luna",
              architecture: "AO_V2",
              ...gated,
              modelResolution,
              ledger: ledger.snapshot(),
              telemetry: telemetry.snapshot(ledger),
              elapsed_ms: Date.now() - startedAt,
            };
          }
        }
      } finally {
        abortSignal?.removeEventListener("abort", abortHandler);
        if (!closed && typeof session.close === "function") {
          closed = true;
          await session.close();
        }
      }
    },
  };
}
