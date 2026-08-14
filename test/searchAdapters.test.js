import assert from "node:assert/strict";
import test from "node:test";
import {
  assertResultContract,
  createGeminiDAdapter,
  createLunaNativeAdapter,
  createSearchAdapterRegistry,
  GEMINI_D_EXECUTION_PIN,
  LUNA_NATIVE_EXECUTION_PIN,
  RESULT_CONTRACT_VERSION,
  SearchAdapterUnsupportedError,
  toResultContract,
} from "../src/searchAdapters/index.js";
import { buildLunaResultItems } from "../src/searchAdapters/lunaNativeAdapter.js";
import { validateNaturalResult } from "../src/validator.js";

const fixture = {
  route: "natural",
  query: "fixture query",
  selected: [{ caseNumber: "2020다1234", match: "direct" }],
  items: [{ caseNumber: "2020다1234", status: "verified" }],
};

test("registry resolves the two product adapter IDs without executing them", () => {
  const registry = createSearchAdapterRegistry();
  assert.deepEqual(registry.ids(), ["gemini_d", "luna_native"]);
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

test("registry cannot be extended beyond the two product adapter IDs", () => {
  assert.throws(
    () => createSearchAdapterRegistry({ adapters: { extra: { runNaturalQuery() {} } } }),
    /SEARCH_ADAPTER_UNSUPPORTED:extra/,
  );
});

test("two product adapters expose one canonical camelCase product contract", async () => {
  const d = createGeminiDAdapter({ run: async () => fixture });
  const luna = createLunaNativeAdapter({ run: async () => fixture });
  const results = await Promise.all([
    d.runNaturalQuery("D"),
    luna.runNaturalQuery("Luna"),
  ]);
  assert.deepEqual(results.map((result) => result.contractVersion), [
    RESULT_CONTRACT_VERSION,
    RESULT_CONTRACT_VERSION,
  ]);
  assert.deepEqual(results.map((result) => result.adapterId), ["gemini_d", "luna_native"]);
  results.forEach(assertResultContract);
  results.forEach((result) => assert.equal(Object.keys(result).some((key) => key.includes("_")), false));
  assert.equal(results[0].modelProtocolClean, null);
  assert.equal(results[0].selectionRepaired, null);
});

test("canonical result contract preserves candidate evidence through validation", async () => {
  const contract = toResultContract({
    route: "natural",
    query: "배관 누수 손해배상",
    selected: [{ caseNumber: "2020나2027066", match: "related" }],
    items: [{
      caseNumber: "2020나2027066",
      status: "verified",
      detail: { caseNumber: "2020나2027066", rawText: "provider original text" },
      lawReferences: [],
    }],
    candidateCaseNumbers: ["2020나2027066"],
    lawReferences: [{ lawName: "민법", article: "제750조", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1" }],
  }, {
    adapterId: "gemini_d",
    provider: "gemini",
    architecture: "D",
  });

  const validated = await validateNaturalResult(contract);
  assert.deepEqual(validated.validationFailures, []);
  assert.deepEqual(validated.selected, [{ caseNumber: "2020나2027066", match: "related" }]);
  assert.equal(validated.items.length, 1);
  assert.deepEqual(validated.lawReferences, [{ lawName: "민법", article: "제750조", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1" }]);

  assert.deepEqual(validated.candidateCaseNumbers, ["2020나2027066"]);
  assert.equal(validated.items.length, 1);
  assert.equal(validated.lawReferences.length, 1);
  assert.equal(validated.contractVersion, RESULT_CONTRACT_VERSION);
});

test("result contract defensively copies provider arrays", () => {
  const candidateCaseNumbers = ["2020나2027066"];
  const lawReferences = [{ lawName: "민법", article: "제750조" }];
  const contract = toResultContract({
    selected: [],
    items: [],
    candidateCaseNumbers,
    lawReferences,
  }, { adapterId: "gemini_d", provider: "gemini", architecture: "D" });

  candidateCaseNumbers.push("2021다1234");
  lawReferences.push({ lawName: "상법", article: "제1조" });
  assert.deepEqual(contract.candidateCaseNumbers, ["2020나2027066"]);
  assert.deepEqual(contract.lawReferences, [{ lawName: "민법", article: "제750조" }]);
});

test("natural result contract still rejects a selected case outside the candidate evidence", async () => {
  const validated = await validateNaturalResult(toResultContract({
    adapterId: "gemini_d",
    provider: "gemini",
    architecture: "D",
    selected: [{ caseNumber: "2020나9999999", match: "related" }],
    items: [{
      caseNumber: "2020나9999999",
      status: "verified",
      detail: { caseNumber: "2020나9999999", rawText: "provider original text" },
    }],
    candidateCaseNumbers: ["2020나2027066"],
  }));
  assert.equal(validated.items.length, 0);
  assert.equal(validated.validationFailures[0]?.reason, "후보 목록 밖의 사건번호입니다.");
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
  assert.deepEqual(result.executionPin, GEMINI_D_EXECUTION_PIN);
});

test("Luna native adapter creates one persistent codex_luna search instance", async () => {
  let factoryCalls = 0;
  let runCalls = 0;
  const adapter = createLunaNativeAdapter({
    createSearch: (options) => {
      factoryCalls += 1;
      assert.deepEqual(options, { provider: "codex_luna" });
      return {
        async runWithContext() {
          runCalls += 1;
          return { result: fixture, ledger: null };
        },
      };
    },
  });
  const first = await adapter.runNaturalQuery("one");
  const second = await adapter.runNaturalQuery("two");
  assert.equal(factoryCalls, 1);
  assert.equal(runCalls, 2);
  assert.equal(LUNA_NATIVE_EXECUTION_PIN.runtime, "codex_sdk");
  assert.deepEqual(first.executionPin, LUNA_NATIVE_EXECUTION_PIN);
  assert.deepEqual(second.executionPin, LUNA_NATIVE_EXECUTION_PIN);
});

test("Luna native adapter keeps candidate evidence scoped to each concurrent invocation", async () => {
  const cases = new Map([
    ["질문 A", "2020다1001"],
    ["질문 B", "2021다2002"],
  ]);
  const adapter = createLunaNativeAdapter({
    createSearch: () => ({
      async runWithContext(query) {
        await new Promise((resolve) => setTimeout(resolve, query.endsWith("A") ? 20 : 1));
        const caseNumber = cases.get(query);
        const candidate = {
          id: query,
          domain: "precedent",
          caseNumber,
          rawCaseNumber: caseNumber,
          canonicalMembers: [caseNumber],
          detailVerified: true,
          title: query,
          sections: { 판시사항: `${query} 판시사항`, 판결요지: `${query} 판결요지` },
        };
        return {
          result: { selected: [{ case_no: caseNumber, match: "direct" }] },
          ledger: {
            getObservedCaseNumbers() { return [caseNumber]; },
            getCase(value) { return value === caseNumber ? candidate : null; },
            snapshot() { return { laws: [] }; },
          },
        };
      },
    }),
  });

  const [first, second] = await Promise.all([
    adapter.runNaturalQuery("질문 A"),
    adapter.runNaturalQuery("질문 B"),
  ]);
  assert.deepEqual(first.candidateCaseNumbers, ["2020다1001"]);
  assert.deepEqual(second.candidateCaseNumbers, ["2021다2002"]);
  assert.deepEqual(first.items.map((item) => item.caseNumber), ["2020다1001"]);
  assert.deepEqual(second.items.map((item) => item.caseNumber), ["2021다2002"]);
  assert.equal(first.items.some((item) => item.caseNumber === "2021다2002"), false);
  assert.equal(second.items.some((item) => item.caseNumber === "2020다1001"), false);
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
