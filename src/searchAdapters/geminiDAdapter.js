import { runDeterministicPipeline } from "../nlPipeline.js";
import * as geminiRuntime from "../geminiRuntime.js";
import { config } from "../../config.js";
import { toResultContract } from "./resultContract.js";

export const GEMINI_D_EXECUTION_PIN = Object.freeze({
  adapter_id: "gemini_d",
  provider: "gemini",
  architecture: "D",
  runtime: "gemini",
  model: config.geminiModel,
  pipeline_mode: "deterministic",
  gemini_request_budget: 2,
});

function pinnedDependencies(options) {
  return {
    ...(options.dependencies || {}),
    generatePlan: geminiRuntime.generatePlan,
    selectCandidates: geminiRuntime.selectCandidates,
    runtimeName: "gemini",
    modelName: config.geminiModel,
    reasoningEffort: null,
  };
}

export function createGeminiDAdapter({ run = runDeterministicPipeline } = {}) {
  return {
    id: "gemini_d",
    provider: "gemini",
    architecture: "D",
    executionPin: GEMINI_D_EXECUTION_PIN,
    async runNaturalQuery(query, options = {}) {
      const result = await run(query, pinnedDependencies(options));
      return toResultContract(result, {
        adapterId: "gemini_d",
        provider: "gemini",
        architecture: "D",
        executionPin: GEMINI_D_EXECUTION_PIN,
      });
    },
  };
}
