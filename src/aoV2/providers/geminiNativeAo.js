import { config } from "../../../config.js";
import { generateAgenticTurn, parseSelectionResponse } from "../../gemini.js";
import { finalizeSelection } from "../finalSelectionGate.js";
import { createSafetyController } from "../safety.js";
import { createTelemetry } from "../telemetry.js";

function functionResponsePart(call, result) {
  return {
    functionResponse: {
      name: call.name,
      id: call.id,
      response: { output: result },
    },
  };
}

function nativeModelTurn(response, functionCalls) {
  return response?.candidates?.[0]?.content || {
    role: "model",
    parts: functionCalls.map((call) => ({ functionCall: call })),
  };
}

export function createGeminiNativeAo({
  gateway,
  ledger = gateway.ledger,
  telemetry = createTelemetry({ provider: "gemini", model: config.geminiModel }),
  safety = createSafetyController(),
  generateTurn = generateAgenticTurn,
  parseFinal = parseSelectionResponse,
  resultMax = config.resultMax,
} = {}) {
  if (!gateway) throw new Error("GEMINI_NATIVE_AO_GATEWAY_REQUIRED");

  return {
    provider: "gemini",
    async run(query) {
      telemetry.setQuestionScopeId(ledger.scopeId);
      const contents = [{ role: "user", parts: [{ text: query }] }];
      let turnIndex = 0;
      const startedAt = Date.now();

      while (true) {
        safety.assertCanContinue();
        const responseMeta = await generateTurn(
          contents,
          ledger.getObservedCaseNumbers(),
          turnIndex,
          { telemetry },
        );
        const response = responseMeta?.response || responseMeta;
        telemetry.recordModelTurn({ usage: response?.usageMetadata || {}, elapsedMs: responseMeta?.elapsedMs || 0 });
        const functionCalls = response?.functionCalls || [];
        if (functionCalls.length === 0) {
          const attempt = parseFinal(response);
          const gated = finalizeSelection(attempt, ledger, { resultMax });
          telemetry.recordSelectionGate(gated);
          telemetry.setStopReason("MODEL_FINAL");
          return {
            provider: "gemini",
            architecture: "AO_V2",
            ...gated,
            ledger: ledger.snapshot(),
            telemetry: telemetry.snapshot(ledger),
            elapsed_ms: Date.now() - startedAt,
          };
        }

        contents.push(nativeModelTurn(response, functionCalls));
        const functionResponses = [];
        for (const call of functionCalls) {
          const result = await gateway.execute(call.name, call.args || {});
          functionResponses.push(functionResponsePart(call, result));
        }
        contents.push({ role: "user", parts: functionResponses });
        safety.noteEvidenceCount(ledger.snapshot().cases.length + ledger.snapshot().laws.length);
        turnIndex += 1;
        if (safety.shouldStopForNoProgress()) {
          telemetry.setStopReason("SAFETY_NO_PROGRESS");
          return {
            provider: "gemini",
            architecture: "AO_V2",
            selected: [],
            intro: "",
            rejectedSelected: [],
            protocolDiagnostics: [{ code: "SAFETY_NO_PROGRESS" }],
            output_valid: false,
            model_protocol_clean: false,
            selection_repaired: false,
            protocolPass: false,
            ledger: ledger.snapshot(),
            telemetry: telemetry.snapshot(ledger),
            elapsed_ms: Date.now() - startedAt,
          };
        }
      }
    },
  };
}
