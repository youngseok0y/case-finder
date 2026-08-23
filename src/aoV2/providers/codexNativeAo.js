import { config } from "../../../config.js";
import { normalizeLegalToolResult } from "../legalToolGateway.js";
import { createSafetyController } from "../safety.js";
import { createTelemetry } from "../telemetry.js";
import { createCommonEvidenceEnvelope } from "../commonEvidenceEnvelope.js";
import { LEGAL_TOOL_NAMES } from "../legalToolDefinitions.js";
import { isLunaTerraFallback } from "../../codexAppServerRuntime.js";

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
    async run(query, { onProgress = () => {} } = {}) {
      telemetry.setQuestionScopeId(ledger.scopeId);
      const startedAt = Date.now();
      const recordDelegatedToolResult = ({ name, arguments: args = {}, result: toolResult } = {}) => {
        const normalized = toolResult?.items || toolResult?.caseNumber || toolResult?.rawText
          ? toolResult
          : normalizeLegalToolResult(name, toolResult || {});
        if (!normalized || normalized.isError) return;
        const snapshot = ledger.snapshot();
        const progress = {
          candidateCount: snapshot.cases.filter((item) => item.discovered).length,
          verifiedCount: snapshot.cases.filter((item) => item.detailVerified).length,
          lawCount: snapshot.laws.filter((item) => item.observed).length,
        };
        if (name === "search_law" || name === "get_law_text") onProgress("LAW_EVIDENCE_UPDATED", progress);
        if (name === "search_decisions") onProgress("CANDIDATES_FOUND", progress);
        if (name === "get_decision_text") onProgress("DETAIL_VERIFIED", progress);
        if (name === "search_decisions") {
          ledger.recordDecisionSearch({ query: args?.query, domain: args?.domain, items: normalized.items || [] });
        } else if (name === "search_law") {
          ledger.recordLawSearch({ query: args?.query, items: normalized.items || [] });
        } else if (name === "get_decision_text") {
          ledger.recordDecisionDetail({
            domain: args?.domain,
            id: args?.id,
            caseNumber: normalized.caseNumber,
            detail: normalized,
            rawText: normalized.rawText,
            verified: true,
          });
        } else if (name === "get_law_text") {
          ledger.recordLawText({
            mst: args?.mst,
            lawId: args?.lawId,
            jo: args?.jo,
            textOpened: Boolean(normalized.rawText),
          });
        }
      };
      const session = await createSession({
        query,
        prompt: buildLunaNativePrompt(query),
        model: config.codexModel,
        reasoningEffort: config.codexReasoningEffort,
        tools: CODEX_NATIVE_ALLOWED_TOOLS.map((name) => ({ name, kind: "legal", restricted: true })),
        onDelegatedToolResult: recordDelegatedToolResult,
      });
      telemetry.setSessionId(session?.sessionId || session?.session_id || null);
      let closed = false;
      try {
        while (true) {
          safety.assertCanContinue();
          const event = await session.next();
          if (!event) throw new Error("CODEX_NATIVE_SESSION_ENDED_WITHOUT_FINAL");
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
              telemetry.recordToolCall(name, {});
              safety.noteEvidenceCount(ledger.snapshot().cases.length + ledger.snapshot().laws.length);
              continue;
            }
            const result = await gateway.execute(name, event.arguments || event.args || {});
            if (typeof session.respondToToolCall !== "function") throw new Error("CODEX_NATIVE_SESSION_TOOL_RESPONSE_REQUIRED");
            await session.respondToToolCall({ callId: event.call_id || event.callId || null, name, result });
            safety.noteEvidenceCount(ledger.snapshot().cases.length + ledger.snapshot().laws.length);
            continue;
          }
          if (event.type === "final") {
            onProgress("FINALIZING", {
              candidateCount: ledger.snapshot().cases.filter((item) => item.discovered).length,
              verifiedCount: ledger.snapshot().cases.filter((item) => item.detailVerified).length,
              lawCount: ledger.snapshot().laws.filter((item) => item.observed).length,
            });
            telemetry.setSessionId(event.session_id || event.sessionId || session?.sessionId || null);
            if (event.usage || event.elapsedMs) telemetry.recordModelTurn({ usage: event.usage || {}, elapsedMs: event.elapsedMs || 0 });
            const modelResolution = event.modelResolution || null;
            if (isLunaTerraFallback(modelResolution)) {
              onProgress("MODEL_FALLBACK", {
                candidateCount: ledger.snapshot().cases.filter((item) => item.discovered).length,
                verifiedCount: ledger.snapshot().cases.filter((item) => item.detailVerified).length,
                lawCount: ledger.snapshot().laws.filter((item) => item.observed).length,
                fallbackApplied: true,
                requestedModel: modelResolution.requestedModel,
                effectiveModel: modelResolution.effectiveModel,
              });
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
        if (!closed && typeof session.close === "function") {
          closed = true;
          await session.close();
        }
      }
    },
  };
}
