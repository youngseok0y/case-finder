import { createGeminiDAdapter } from "./geminiDAdapter.js";
import { createLunaNativeAdapter } from "./lunaNativeAdapter.js";

export const SEARCH_ADAPTER_IDS = Object.freeze(["gemini_d", "luna_native"]);

export class SearchAdapterUnsupportedError extends Error {
  constructor(adapterId) {
    super(`SEARCH_ADAPTER_UNSUPPORTED:${adapterId}`);
    this.name = "SearchAdapterUnsupportedError";
    this.code = "SEARCH_ADAPTER_UNSUPPORTED";
    this.adapterId = adapterId;
  }
}

export function createSearchAdapterRegistry({ adapters = {} } = {}) {
  const entries = new Map([
    ["gemini_d", createGeminiDAdapter()],
    ["luna_native", createLunaNativeAdapter()],
  ]);
  for (const [id, adapter] of Object.entries(adapters)) {
    if (!SEARCH_ADAPTER_IDS.includes(id)) throw new SearchAdapterUnsupportedError(id);
    entries.set(id, adapter);
  }
  return {
    ids() {
      return [...SEARCH_ADAPTER_IDS];
    },
    resolve(adapterId = process.env.SEARCH_ADAPTER || "gemini_d") {
      const adapter = entries.get(adapterId);
      if (!adapter || typeof adapter.runNaturalQuery !== "function") throw new SearchAdapterUnsupportedError(adapterId);
      return adapter;
    },
  };
}

export const defaultSearchAdapterRegistry = createSearchAdapterRegistry();
