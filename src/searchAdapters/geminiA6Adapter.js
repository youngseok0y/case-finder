import { runAgenticPipeline } from "../agenticPipeline.js";
import * as geminiRuntime from "../geminiRuntime.js";
import { config } from "../../config.js";
import { toResultContract } from "./resultContract.js";

export const GEMINI_A6_EXECUTION_PIN = Object.freeze({
  adapter_id: "gemini_a6",
  provider: "gemini",
  architecture: "A6",
  runtime: "gemini",
  model: config.geminiModel,
  pipeline_mode: "agentic",
  agentic_mode: "bounded",
  agentic_call_max: 6,
});

export function createGeminiA6Adapter({ run = runAgenticPipeline } = {}) {
  return {
    id: "gemini_a6",
    provider: "gemini",
    architecture: "A6",
    executionPin: GEMINI_A6_EXECUTION_PIN,
    async runNaturalQuery(query, options = {}) {
      const result = await run(query, {
        ...options,
        runtime: {
          generateAgenticTurn: geminiRuntime.generateAgenticTurn,
          parseSelectionResponse: geminiRuntime.parseSelectionResponse,
          runtimeName: "gemini",
          modelName: config.geminiModel,
          reasoningEffort: null,
        },
        agenticMode: "bounded",
        agenticCallMax: 6,
      });
      return toResultContract(result, {
        adapterId: "gemini_a6",
        provider: "gemini",
        architecture: "A6",
        executionPin: GEMINI_A6_EXECUTION_PIN,
      });
    },
  };
}
