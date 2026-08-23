import { config } from "../../config.js";
import { createEvidenceLedger } from "./evidenceLedger.js";
import { createLegalToolGateway } from "./legalToolGateway.js";
import { createSafetyController } from "./safety.js";
import { createTelemetry } from "./telemetry.js";
import { createCodexNativeAo } from "./providers/codexNativeAo.js";
import { createCommonEvidenceEnvelope } from "./commonEvidenceEnvelope.js";

export { createEvidenceLedger, providerBoundCaseIdentityCompatibility } from "./evidenceLedger.js";
export { createLegalToolGateway, LEGAL_TOOL_NAMES } from "./legalToolGateway.js";
export {
  createFinalSelectionGate,
  finalizeSelection,
  normalizeLawArticle,
  sanitizeEvidenceNarrative,
} from "./finalSelectionGate.js";
export { createSafetyController } from "./safety.js";
export { createTelemetry } from "./telemetry.js";
export { createCodexNativeAo } from "./providers/codexNativeAo.js";
export {
  canonicalCaseIdentity,
  canonicalCaseNumber,
  caseIdentityMatches,
  commonEvidenceState,
  createCommonEvidenceEnvelope,
  evidenceProgressSnapshot,
  evidenceProgressSignature,
  hasSubstantiveEvidenceProgress,
  parseProviderCaseNumber,
  expandProviderCaseNumberSet,
  SELECTION_REPAIR_REASON_CODES,
  selectionRepairReasons,
} from "./commonEvidenceEnvelope.js";

export function createAgenticSearchV2({
  provider = "codex_luna",
  gatewayOptions = {},
  adapterOptions = {},
} = {}) {
  let lastRun = null;
  async function runWithContext(query, runOptions = {}) {
    const ledger = createEvidenceLedger({ provider });
    const telemetry = createTelemetry({
      provider,
      model: provider === "codex_luna" ? config.codexModel : config.geminiModel,
      reasoningEffort: provider === "codex_luna" ? config.codexReasoningEffort : null,
      questionScopeId: ledger.scopeId,
    });
    const safety = createSafetyController();
    const envelope = createCommonEvidenceEnvelope({
      ledger,
      resultMax: Number.isInteger(adapterOptions.resultMax) ? adapterOptions.resultMax : config.resultMax,
    });
    const gateway = createLegalToolGateway({ ...gatewayOptions, ledger, telemetry, safety });
    if (provider !== "codex_luna") throw new Error(`AO_V2_PROVIDER_RETIRED:${provider}`);
    const adapter = createCodexNativeAo({ ...adapterOptions, gateway, ledger, telemetry, safety, envelope });
    const result = await adapter.run(query, runOptions);
    const context = { result, ledger, envelope, telemetry, safety, gateway };
    // This is retained for diagnostics/backward compatibility only. Product
    // correctness must use the context returned by this invocation.
    lastRun = context;
    return context;
  }
  return {
    provider,
    get lastRun() {
      return lastRun;
    },
    runWithContext,
    async runAgenticSearchV2(query) {
      return (await runWithContext(query)).result;
    },
  };
}

export async function runAgenticSearchV2(query, options = {}) {
  return createAgenticSearchV2(options).runAgenticSearchV2(query);
}
