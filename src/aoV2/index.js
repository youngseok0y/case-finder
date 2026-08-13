import { config } from "../../config.js";
import { createEvidenceLedger } from "./evidenceLedger.js";
import { createLegalToolGateway } from "./legalToolGateway.js";
import { createSafetyController } from "./safety.js";
import { createTelemetry } from "./telemetry.js";
import { createGeminiNativeAo } from "./providers/geminiNativeAo.js";
import { createCodexNativeAo } from "./providers/codexNativeAo.js";

export { createEvidenceLedger } from "./evidenceLedger.js";
export { createLegalToolGateway, LEGAL_TOOL_NAMES } from "./legalToolGateway.js";
export { createFinalSelectionGate, finalizeSelection } from "./finalSelectionGate.js";
export { createSafetyController } from "./safety.js";
export { createTelemetry } from "./telemetry.js";
export { createGeminiNativeAo } from "./providers/geminiNativeAo.js";
export { createCodexNativeAo } from "./providers/codexNativeAo.js";

export function createAgenticSearchV2({
  provider = config.modelRuntime === "codex_cli" ? "codex_luna" : "gemini",
  gatewayOptions = {},
  adapterOptions = {},
} = {}) {
  let lastRun = null;
  return {
    provider,
    get lastRun() {
      return lastRun;
    },
    async runAgenticSearchV2(query) {
      const ledger = createEvidenceLedger({ provider });
      const telemetry = createTelemetry({
        provider,
        model: provider === "codex_luna" ? config.codexModel : config.geminiModel,
        reasoningEffort: provider === "codex_luna" ? config.codexReasoningEffort : null,
        questionScopeId: ledger.scopeId,
      });
      const safety = createSafetyController();
      const gateway = createLegalToolGateway({ ...gatewayOptions, ledger, telemetry, safety });
      const adapter = provider === "codex_luna"
        ? createCodexNativeAo({ ...adapterOptions, gateway, ledger, telemetry, safety })
        : createGeminiNativeAo({ ...adapterOptions, gateway, ledger, telemetry, safety });
      lastRun = { ledger, telemetry, safety, gateway };
      return adapter.run(query);
    },
  };
}

export async function runAgenticSearchV2(query, options = {}) {
  return createAgenticSearchV2(options).runAgenticSearchV2(query);
}
