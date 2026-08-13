import { runAgenticPipeline } from "../agenticPipeline.js";
import { toResultContract } from "./resultContract.js";

export function createGeminiA6Adapter({ run = runAgenticPipeline } = {}) {
  return {
    id: "gemini_a6",
    provider: "gemini",
    architecture: "A6",
    async runNaturalQuery(query, options = {}) {
      const result = await run(query, options);
      return toResultContract(result, { adapterId: "gemini_a6", provider: "gemini", architecture: "A6" });
    },
  };
}
