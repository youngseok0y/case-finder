import { createGeminiDAdapter } from "./geminiDAdapter.js";
import { createLunaNativeAdapter } from "./lunaNativeAdapter.js";
import { SEARCH_ADAPTER_CATALOG, SEARCH_ADAPTER_IDS } from "./catalog.js";

export { SEARCH_ADAPTER_CATALOG, SEARCH_ADAPTER_IDS } from "./catalog.js";

export class SearchAdapterUnsupportedError extends Error {
  constructor(adapterId) {
    super(`SEARCH_ADAPTER_UNSUPPORTED:${adapterId}`);
    this.name = "SearchAdapterUnsupportedError";
    this.code = "SEARCH_ADAPTER_UNSUPPORTED";
    this.adapterId = adapterId;
  }
}

export function createSearchAdapterRegistry({ adapters = {} } = {}) {
  const factories = {
    gemini_d: createGeminiDAdapter,
    luna_native: createLunaNativeAdapter,
  };
  const entries = new Map(SEARCH_ADAPTER_CATALOG.map(({ id }) => [id, factories[id]()]));
  for (const [id, adapter] of Object.entries(adapters)) {
    if (!SEARCH_ADAPTER_IDS.includes(id)) throw new SearchAdapterUnsupportedError(id);
    entries.set(id, adapter);
  }
  return {
    ids() {
      return [...SEARCH_ADAPTER_IDS];
    },
    resolve(adapterId) {
      const adapter = entries.get(adapterId);
      if (!adapter || typeof adapter.runNaturalQuery !== "function") throw new SearchAdapterUnsupportedError(adapterId);
      return adapter;
    },
  };
}

export const defaultSearchAdapterRegistry = createSearchAdapterRegistry();
