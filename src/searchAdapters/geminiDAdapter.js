import { runDeterministicPipeline } from "../nlPipeline.js";
import { toResultContract } from "./resultContract.js";

export function createGeminiDAdapter({ run = runDeterministicPipeline } = {}) {
  return {
    id: "gemini_d",
    provider: "gemini",
    architecture: "D",
    async runNaturalQuery(query, options = {}) {
      const result = await run(query, options.dependencies || {});
      return toResultContract(result, { adapterId: "gemini_d", provider: "gemini", architecture: "D" });
    },
  };
}
