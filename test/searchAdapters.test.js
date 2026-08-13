import assert from "node:assert/strict";
import test from "node:test";
import {
  assertResultContract,
  createGeminiA6Adapter,
  createGeminiDAdapter,
  createLunaNativeAdapter,
  createSearchAdapterRegistry,
  RESULT_CONTRACT_VERSION,
  SearchAdapterUnsupportedError,
} from "../src/searchAdapters/index.js";

const fixture = {
  route: "natural",
  query: "fixture query",
  selected: [{ caseNumber: "2020다1234", match: "direct" }],
  items: [{ caseNumber: "2020다1234", status: "verified" }],
};

test("registry resolves the three M9 adapter IDs without executing them", () => {
  const registry = createSearchAdapterRegistry();
  assert.deepEqual(registry.ids(), ["gemini_d", "gemini_a6", "luna_native"]);
  for (const id of registry.ids()) {
    const adapter = registry.resolve(id);
    assert.equal(adapter.id, id);
    assert.equal(typeof adapter.runNaturalQuery, "function");
  }
});

test("registry rejects unknown adapter IDs with stable error code", () => {
  const registry = createSearchAdapterRegistry();
  assert.throws(() => registry.resolve("unknown"), (error) => {
    assert.equal(error instanceof SearchAdapterUnsupportedError, true);
    assert.equal(error.code, "SEARCH_ADAPTER_UNSUPPORTED");
    return true;
  });
});

test("three adapters expose the common result contract through thin wrappers", async () => {
  const d = createGeminiDAdapter({ run: async () => fixture });
  const a6 = createGeminiA6Adapter({ run: async () => fixture });
  const luna = createLunaNativeAdapter({ run: async () => fixture });
  const results = await Promise.all([
    d.runNaturalQuery("D"),
    a6.runNaturalQuery("A6"),
    luna.runNaturalQuery("Luna"),
  ]);
  assert.deepEqual(results.map((result) => result.contract_version), [
    RESULT_CONTRACT_VERSION,
    RESULT_CONTRACT_VERSION,
    RESULT_CONTRACT_VERSION,
  ]);
  assert.deepEqual(results.map((result) => result.adapter_id), ["gemini_d", "gemini_a6", "luna_native"]);
  results.forEach(assertResultContract);
});
