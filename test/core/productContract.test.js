// Consolidated from test/adapters.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { config } = await import("../../config.js");
  const { ADMIN_SETTING_KEYS, validateAdminPatch } = await import("../../src/adminConfig.js");
  const {
  createSearchAdapterRegistry,
  GEMINI_D_EXECUTION_PIN,
  LUNA_NATIVE_EXECUTION_PIN,
  SearchAdapterUnsupportedError,
  SEARCH_ADAPTER_IDS,
  toResultContract,
} = await import("../../src/searchAdapters/index.js");
  const { validateNaturalResult } = await import("../../src/validator.js");
  test("product adapter registry and search configuration are frozen", () => {
    assert.deepEqual(SEARCH_ADAPTER_IDS, ["gemini_d", "luna_native"]);
    assert.deepEqual(createSearchAdapterRegistry({ adapters: {
      gemini_d: { runNaturalQuery: async () => ({}) },
      luna_native: { runNaturalQuery: async () => ({}) },
    } }).ids(), ["gemini_d", "luna_native"]);
    assert.equal(config.searchAdapter, "luna_native");
    assert.equal(config.searchDisplay, 20);
    assert.equal(config.candidateMax, 20);
    assert.equal(config.resultMax, 5);
    assert.equal(ADMIN_SETTING_KEYS.includes("SEARCH_DISPLAY"), false);
    assert.equal(ADMIN_SETTING_KEYS.includes("GCP_PROJECT_ID"), false);
    assert.throws(() => validateAdminPatch({ SEARCH_DISPLAY: "10" }), /ADMIN_SETTING_NOT_ALLOWED/u);
    assert.throws(() => createSearchAdapterRegistry({ adapters: { gemini_a6: {} } }), SearchAdapterUnsupportedError);
  });

  test("provider and model pins remain fixed", () => {
    assert.equal(GEMINI_D_EXECUTION_PIN.adapterId, "gemini_d");
    assert.equal(GEMINI_D_EXECUTION_PIN.model, "gemini-3.5-flash-lite");
    assert.equal(GEMINI_D_EXECUTION_PIN.geminiRequestBudget, 2);
    assert.equal(LUNA_NATIVE_EXECUTION_PIN.adapterId, "luna_native");
    assert.equal(LUNA_NATIVE_EXECUTION_PIN.model, "gpt-5.6-luna");
    assert.equal(LUNA_NATIVE_EXECUTION_PIN.reasoningEffort, "medium");
  });

  test("natural result validation preserves verified-only output and terminal states", async () => {
    const result = toResultContract({
      query: "verified fixture",
      selected: [
        { caseNumber: "2020다1234", match: "direct" },
        { caseNumber: "2020다9999", match: "related" },
      ],
      candidateCaseNumbers: ["2020다1234", "2020다9999"],
      items: [
        { status: "verified", caseNumber: "2020다1234", detail: { caseNumber: "2020다1234", rawText: "provider decision text" } },
        { status: "validation_failed", caseNumber: "2020다9999", detail: { caseNumber: "2020다9999" } },
      ],
    }, { adapterId: "gemini_d", provider: "gemini", architecture: "D" });
    const validated = await validateNaturalResult(result);
    assert.deepEqual(validated.items.map((item) => item.caseNumber), ["2020다1234"]);
    assert.equal(validated.terminalState, "PARTIAL_VERIFIED");

    const noResult = toResultContract({ query: "empty", selected: [], items: [], candidateCaseNumbers: [] }, {
      adapterId: "luna_native", provider: "codex_luna", architecture: "AO_V2_NATIVE",
    });
    assert.equal(noResult.terminalState, "NO_RESULT");
  });
})();

// Consolidated from test/productFlow.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { decisionDetailLink, lawDetailLink, sanitizeApiLink } = await import("../../src/directLookup.js");
  const { renderResults } = await import("../../src/renderer.js");
  const { createGeminiDAdapter, createLunaNativeAdapter, toResultContract } = await import("../../src/searchAdapters/index.js");
  const { validateNaturalResult } = await import("../../src/validator.js");
  const { routeQuery } = await import("../../src/router.js");
  const caseItem = {
    status: "verified",
    caseNumber: "2020나2027066",
    providerId: "614471",
    title: "배관 누수 손해배상",
    court: "서울고등법원",
    date: "2024-01-01",
    link: decisionDetailLink("precedent", "614471"),
    detail: { caseNumber: "2020나2027066", rawText: "provider original text", sections: {} },
  };

  async function valid(result) {
    return validateNaturalResult(result);
  }

  test("direct case routing stays deterministic", () => {
    assert.deepEqual(routeQuery("2020다1234 확인").kind, "direct");
    assert.equal(routeQuery("계약 해지 손해배상").kind, "natural");
  });

  test("Gemini and Luna adapters map verified provider results to the same product flow", async () => {
    const gemini = createGeminiDAdapter({ run: async () => ({
      query: "배관 누수 손해배상",
      selected: [{ caseNumber: caseItem.caseNumber, match: "direct" }],
      items: [caseItem],
      candidateCaseNumbers: [caseItem.caseNumber],
      lawReferences: [{ lawName: "민법", article: "제750조", link: lawDetailLink("284415") }],
    }) });
    const luna = createLunaNativeAdapter({ run: async () => ({
      query: "배관 누수 손해배상",
      selected: [{ case_no: caseItem.caseNumber, match: "related" }],
      items: [caseItem],
      candidateCaseNumbers: [caseItem.caseNumber],
    }) });

    const geminiResult = await valid(await gemini.runNaturalQuery("배관 누수 손해배상"));
    const lunaResult = await valid(await luna.runNaturalQuery("배관 누수 손해배상"));
    assert.equal(geminiResult.items.length, 1);
    assert.equal(lunaResult.items.length, 1);
    assert.equal(lunaResult.provider, "codex_luna");
    assert.match(renderResults(geminiResult), /2020나2027066/u);
    assert.match(renderResults(lunaResult), /2020나2027066/u);
  });

  test("provider links and empty/failure terminal contracts remain honest", () => {
    assert.equal(decisionDetailLink("precedent", "614471"), "https://www.law.go.kr/LSW/precInfoP.do?precSeq=614471");
    assert.equal(decisionDetailLink("constitutional", "614472"), "https://www.law.go.kr/LSW/detcInfoP.do?detcSeq=614472");
    assert.equal(decisionDetailLink("admin_appeal", "614473"), "https://www.law.go.kr/LSW/deccInfoP.do?deccSeq=614473");
    assert.equal(sanitizeApiLink("https://www.law.go.kr/DRF/lawService.do?target=decc&ID=614473"), "https://www.law.go.kr/LSW/deccInfoP.do?deccSeq=614473");
    assert.equal(lawDetailLink("284415"), "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=284415");
    assert.equal(toResultContract({ query: "empty", selected: [], items: [], candidateCaseNumbers: [] }, {
      adapterId: "gemini_d", provider: "gemini", architecture: "D",
    }).terminalState, "NO_RESULT");
    assert.equal(toResultContract({ query: "failure", error: "provider unavailable", selected: [], items: [], candidateCaseNumbers: [] }, {
      adapterId: "luna_native", provider: "codex_luna", architecture: "AO_V2_NATIVE",
    }).terminalState, "SEARCH_FAILED");
  });

  test("Luna verified administrative-appeal items use the safe user-facing detail link", async () => {
    const { buildLunaResultItems } = await import("../../src/searchAdapters/lunaNativeAdapter.js");
    const adminCase = {
      id: "614473",
      domain: "admin_appeal",
      caseNumber: "2024행심123",
      rawCaseNumber: "2024행심123",
      title: "행정심판 fixture",
      court: "중앙행정심판위원회",
      date: "2024. 1. 1.",
      detailVerified: true,
      rawText: "provider administrative appeal text",
    };
    const items = buildLunaResultItems({ selected: [{ case_no: adminCase.caseNumber, match: "direct" }] }, {
      getCase: () => adminCase,
      getDetailText: () => adminCase.rawText,
    });
    assert.equal(items[0].link, decisionDetailLink("admin_appeal", adminCase.id));
    assert.match(renderResults({
      terminalState: "SUCCESS",
      query: "행정심판 fixture",
      items,
      lawReferences: [],
    }), /\/LSW\/deccInfoP\.do\?deccSeq=614473/u);
  });
})();
