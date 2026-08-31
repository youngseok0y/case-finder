const CATALOG = [
  Object.freeze({ id: "gemini_d", label: "Gemini 빠른 검색", stage: "GEMINI_D" }),
  Object.freeze({ id: "luna_native", label: "Luna 고정밀 검색", stage: "LUNA_NATIVE" }),
];

export const SEARCH_ADAPTER_CATALOG = Object.freeze(CATALOG);
export const SEARCH_ADAPTER_IDS = Object.freeze(CATALOG.map((adapter) => adapter.id));

export function getSearchAdapterDefinition(adapterId) {
  return SEARCH_ADAPTER_CATALOG.find((adapter) => adapter.id === adapterId) || null;
}

export function isSupportedSearchAdapter(adapterId) {
  return Boolean(getSearchAdapterDefinition(adapterId));
}
