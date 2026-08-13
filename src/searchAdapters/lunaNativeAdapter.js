import { runAgenticSearchV2 } from "../aoV2/index.js";
import { toResultContract } from "./resultContract.js";

export function createLunaNativeAdapter({ run = runAgenticSearchV2 } = {}) {
  return {
    id: "luna_native",
    provider: "luna",
    architecture: "AO_V2_NATIVE",
    async runNaturalQuery(query, options = {}) {
      const result = await run(query, { provider: "codex_luna", ...options });
      return toResultContract(result, { adapterId: "luna_native", provider: "luna", architecture: "AO_V2_NATIVE" });
    },
  };
}
