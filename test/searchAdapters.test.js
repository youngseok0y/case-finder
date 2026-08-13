import assert from "node:assert/strict";
import test from "node:test";
import { runAgenticSearch } from "../src/agenticPipeline.js";
import {
  assertResultContract,
  createGeminiA6Adapter,
  createGeminiDAdapter,
  createLunaNativeAdapter,
  createSearchAdapterRegistry,
  GEMINI_A6_EXECUTION_PIN,
  GEMINI_D_EXECUTION_PIN,
  LUNA_NATIVE_EXECUTION_PIN,
  RESULT_CONTRACT_VERSION,
  SearchAdapterUnsupportedError,
} from "../src/searchAdapters/index.js";
import { buildLunaResultItems } from "../src/searchAdapters/lunaNativeAdapter.js";

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

test("registry cannot be extended beyond the three blind arm IDs", () => {
  assert.throws(
    () => createSearchAdapterRegistry({ adapters: { extra: { runNaturalQuery() {} } } }),
    /SEARCH_ADAPTER_UNSUPPORTED:extra/,
  );
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

test("Gemini D adapter pins Gemini deterministic runtime even when globals request Codex", async () => {
  let receivedDependencies;
  const adapter = createGeminiDAdapter({
    run: async (_query, dependencies) => {
      receivedDependencies = dependencies;
      return fixture;
    },
  });
  const result = await adapter.runNaturalQuery("D", {
    dependencies: { runtimeName: "codex_cli", modelName: "wrong", generatePlan: "wrong" },
  });
  assert.equal(receivedDependencies.runtimeName, "gemini");
  assert.equal(receivedDependencies.modelName, GEMINI_D_EXECUTION_PIN.model);
  assert.equal(typeof receivedDependencies.generatePlan, "function");
  assert.deepEqual(result.execution_pin, GEMINI_D_EXECUTION_PIN);
});

test("Gemini A6 adapter pins bounded Gemini with call max six", async () => {
  let receivedOptions;
  const adapter = createGeminiA6Adapter({
    run: async (_query, options) => {
      receivedOptions = options;
      return fixture;
    },
  });
  const result = await adapter.runNaturalQuery("A6", {
    runtime: { runtimeName: "codex_cli" },
    agenticMode: "open",
    agenticCallMax: 99,
  });
  assert.equal(receivedOptions.runtime.runtimeName, "gemini");
  assert.equal(receivedOptions.agenticMode, "bounded");
  assert.equal(receivedOptions.agenticCallMax, 6);
  assert.equal(typeof receivedOptions.runtime.generateAgenticTurn, "function");
  assert.deepEqual(result.execution_pin, GEMINI_A6_EXECUTION_PIN);
});

test("bounded agentic runtime forwards the pinned question limit to Gemini reservation", async () => {
  let receivedOptions;
  const search = await runAgenticSearch("bounded A6", {
    runtime: {
      runtimeName: "gemini",
      modelName: GEMINI_A6_EXECUTION_PIN.model,
      reasoningEffort: null,
      generateAgenticTurn: async (_contents, _observedCaseNumbers, _questionCalls, options) => {
        receivedOptions = options;
        return { response: { functionCalls: [] }, callsUsed: 1 };
      },
      parseSelectionResponse: () => ({ selected: [], intro: "" }),
    },
    agenticMode: "bounded",
    agenticCallMax: 6,
  });
  assert.equal(search.stopReason, "MODEL_FINAL");
  assert.equal(receivedOptions.enforceQuestionLimit, true);
  assert.equal(receivedOptions.questionLimit, 6);
});

test("Luna native adapter creates one persistent codex_luna search instance", async () => {
  let factoryCalls = 0;
  let runCalls = 0;
  const adapter = createLunaNativeAdapter({
    createSearch: (options) => {
      factoryCalls += 1;
      assert.deepEqual(options, { provider: "codex_luna" });
      return {
        async runAgenticSearchV2() {
          runCalls += 1;
          return fixture;
        },
      };
    },
  });
  const first = await adapter.runNaturalQuery("one");
  const second = await adapter.runNaturalQuery("two");
  assert.equal(factoryCalls, 1);
  assert.equal(runCalls, 2);
  assert.deepEqual(first.execution_pin, LUNA_NATIVE_EXECUTION_PIN);
  assert.deepEqual(second.execution_pin, LUNA_NATIVE_EXECUTION_PIN);
});

test("Luna native adapter preserves verified ledger evidence as result items", () => {
  const items = buildLunaResultItems(
    { selected: [{ case_no: "2020??234", match: "direct" }] },
    {
      getCase(caseNumber) {
        assert.equal(caseNumber, "2020??234");
        return {
          id: "12345",
          domain: "precedent",
          caseNumber: "2020??234",
          rawCaseNumber: "2020??234, 235",
          canonicalMembers: ["2020??234", "2020??235"],
          detailVerified: true,
          title: "fixture case",
          sections: { "재결요지": "fixture" },
        };
      },
    },
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "verified");
  assert.equal(items[0].providerCaseNumber, "2020??234, 235");
  assert.equal(items[0].link, "https://www.law.go.kr/LSW/precInfoP.do?precSeq=12345");
});
