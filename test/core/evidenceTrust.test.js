// Consolidated from test/commonEvidenceEnvelope.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const {
  canonicalCaseIdentity,
  caseIdentityMatches,
  commonEvidenceState,
  createCommonEvidenceEnvelope,
} = await import("../../src/aoV2/commonEvidenceEnvelope.js");
  const { createEvidenceLedger, parseProviderCompoundCaseNumber } = await import("../../src/aoV2/evidenceLedger.js");
  const { expandCaseNumberSet, parseCaseNumber, routeQuery } = await import("../../src/router.js");
  const {
    canonicalCaseNumber,
    expandCaseIdentitySet,
    parseCaseIdentity,
  } = await import("../../src/caseIdentity.js");
  const { createAgenticSearchV2 } = await import("../../src/aoV2/index.js");
  const { createLunaNativeAdapter } = await import("../../src/searchAdapters/lunaNativeAdapter.js");
  function replayDetail({ observedCaseNumber, returnedCaseNumber = observedCaseNumber, id = "fixture" }) {
    const ledger = createEvidenceLedger({ provider: "common-envelope-fixture" });
    ledger.recordDecisionSearch({
      query: "common envelope fixture",
      domain: "precedent",
      items: [{ id, caseNumber: observedCaseNumber }],
    });
    const result = ledger.recordDecisionDetail({
      domain: "precedent",
      id,
      caseNumber: returnedCaseNumber,
      detail: { caseNumber: returnedCaseNumber },
      rawText: "provider decision text",
      verified: true,
    });
    return { ledger, result };
  }

  test("므 exact-single detail transitions to verified through the common ledger", () => {
    for (const caseNumber of ["2023므10519", "2023므13723", "2023므11819", "2013므2441"]) {
      assert.deepEqual(parseCaseNumber(caseNumber), {
        year: caseNumber.slice(0, 4),
        typeCode: "므",
        serial: caseNumber.slice(5),
        caseNumber,
      });
      const { ledger, result } = replayDetail({ observedCaseNumber: caseNumber, id: `exact-${caseNumber}` });
      assert.equal(result.verified, true, caseNumber);
      assert.equal(ledger.getVerifiedCases().length, 1, caseNumber);
      assert.equal(ledger.snapshot().verificationFailures.length, 0, caseNumber);
    }
  });

  test("common envelope keeps controls, mismatch, and compound identity safe", () => {
    for (const caseNumber of ["2023두61349", "2019후12094", "2017도19025"]) {
      assert.equal(replayDetail({ observedCaseNumber: caseNumber }).result.verified, true, caseNumber);
    }

    const mismatch = replayDetail({
      observedCaseNumber: "2023므10519",
      returnedCaseNumber: "2023므13723",
      id: "mismatch",
    });
    assert.equal(mismatch.result.verified, false);
    assert.equal(mismatch.ledger.snapshot().verificationFailures[0].code, "DETAIL_IDENTITY_MISMATCH");

    const compound = "2020므13562, 13579";
    assert.deepEqual(parseProviderCompoundCaseNumber(compound).canonicalMembers, ["2020므13562", "2020므13579"]);
    assert.equal(caseIdentityMatches("2020므13562", compound), false);
    assert.equal(replayDetail({
      observedCaseNumber: "2020므13562",
      returnedCaseNumber: compound,
      id: "single-to-compound",
    }).result.verified, true);
    assert.equal(replayDetail({
      observedCaseNumber: compound,
      returnedCaseNumber: compound,
      id: "compound-to-compound",
    }).result.verified, true);
    assert.equal(replayDetail({
      observedCaseNumber: "2022다286656, 286663",
      returnedCaseNumber: "2022다286656, 286663",
      id: "non-family-compound",
    }).result.verified, true);
  });

  test("provider evidence verifies an unknown case code without router whitelist membership", () => {
    const exact = replayDetail({ observedCaseNumber: "2027새12345", id: "unknown-code" });
    assert.equal(parseCaseNumber("2027새12345"), null);
    assert.equal(exact.result.verified, true);
    assert.equal(exact.ledger.snapshot().detailTraces[0].same_provider_provenance, true);
    assert.equal(exact.ledger.snapshot().verificationFailures.length, 0);

    const mismatch = replayDetail({
      observedCaseNumber: "2027새12345",
      returnedCaseNumber: "2027새54321",
      id: "unknown-code-mismatch",
    });
    assert.equal(mismatch.result.verified, false);
    assert.equal(mismatch.ledger.snapshot().verificationFailures[0].code, "DETAIL_IDENTITY_MISMATCH");
  });

  test("canonical case identity stays independent from the router allowlist", () => {
    assert.deepEqual(parseCaseIdentity("대법원 - ２０２４ - 다 - １２３４５"), {
      year: "2024",
      typeCode: "다",
      serial: "12345",
      caseNumber: "2024다12345",
    });
    assert.equal(canonicalCaseIdentity("99-두-2963"), "99두2963");
    assert.equal(canonicalCaseIdentity("2027새12345"), "2027새12345");
    assert.deepEqual([...expandCaseIdentitySet("2020므13562, 13579")], ["2020므13562", "2020므13579"]);
    assert.equal(canonicalCaseNumber("2020므13562, 13579"), "2020므13562,2020므13579");
    assert.deepEqual([...expandCaseNumberSet("2027 새 12345")], ["2027새12345"]);
    assert.equal(parseCaseNumber("2027새12345"), null);
    assert.equal(routeQuery("2027새12345").kind, "natural");
  });

  test("verified evidence remains monotonic after a failed detail re-fetch", () => {
    const ledger = createEvidenceLedger({ provider: "monotonic-detail-fixture" });
    ledger.recordDecisionSearch({
      domain: "precedent",
      query: "monotonic detail fixture",
      items: [{ id: "stable-id", caseNumber: "2024다12345" }],
    });
    const initial = ledger.recordDecisionDetail({
      domain: "precedent",
      id: "stable-id",
      caseNumber: "2024다12345",
      detail: { caseNumber: "2024다12345", court: "대법원", sections: { 판결요지: "verified section" } },
      rawText: "verified provider text",
      verified: true,
    });
    const before = ledger.getCase("2024다12345");
    const digest = before.detailDigest;

    const retry = ledger.recordDecisionDetail({
      domain: "precedent",
      id: "stable-id",
      caseNumber: "2024다12345",
      detail: { caseNumber: "2024다12345", court: "untrusted replacement", sections: { 판결요지: "untrusted replacement" } },
      rawText: "",
      verified: false,
    });
    const after = ledger.getCase("2024다12345");

    assert.equal(initial.verified, true);
    assert.equal(retry.verified, true);
    assert.equal(after.detailVerified, true);
    assert.equal(after.evidenceState, "VERIFIED");
    assert.equal(after.failureCode, "");
    assert.equal(after.detailDigest, digest);
    assert.equal(after.court, "대법원");
    assert.equal(after.sections.판결요지, "verified section");
    assert.equal(ledger.getDetailText("2024다12345"), "verified provider text");
    assert.equal(after.verificationFailures.at(-1).code, "DETAIL_TEXT_MISSING");
    assert.equal(ledger.snapshot().detailTraces.at(-1).verified, false);
    assert.equal(ledger.snapshot().detailTraces.at(-1).verification_code, "DETAIL_TEXT_MISSING");
  });

  test("provider detail requires the observed provider ID provenance", () => {
    const ledger = createEvidenceLedger({ provider: "provenance-fixture" });
    ledger.recordDecisionSearch({
      query: "provenance fixture",
      domain: "precedent",
      items: [{ id: "observed-id", caseNumber: "2027새12345" }],
    });
    const rejected = ledger.recordDecisionDetail({
      domain: "precedent",
      id: "different-id",
      caseNumber: "2027새12345",
      detail: { caseNumber: "2027새12345" },
      rawText: "provider decision text",
      verified: true,
    });
    assert.equal(rejected.verified, false);
    assert.equal(ledger.snapshot().verificationFailures[0].code, "DETAIL_PROVIDER_PROVENANCE_MISMATCH");
    assert.equal(ledger.snapshot().detailTraces[0].same_provider_provenance, false);
  });

  test("provider detail provenance is bound to the decision domain", () => {
    const ledger = createEvidenceLedger({ provider: "domain-provenance-fixture" });
    ledger.recordDecisionSearch({
      query: "precedent fixture",
      domain: "precedent",
      items: [{ id: "123", caseNumber: "2020다1234" }],
    });
    ledger.recordDecisionSearch({
      query: "constitutional fixture",
      domain: "constitutional",
      items: [{ id: "123", caseNumber: "2020헌마123" }],
    });

    const verified = ledger.recordDecisionDetail({
      domain: "constitutional",
      id: "123",
      caseNumber: "2020헌마123",
      rawText: "constitutional provider decision text",
    });

    assert.equal(verified.verified, true);
    assert.equal(ledger.getCase("2020헌마123").detailVerified, true);
    assert.equal(ledger.getCase("2020다1234").detailVerified, false);
  });

  test("common envelope exposes the same observed, verified, and selectable state", () => {
    const { ledger } = replayDetail({ observedCaseNumber: "2023므10519", id: "state" });
    const envelope = createCommonEvidenceEnvelope({ ledger, resultMax: 5 });
    const gated = envelope.validateSelection({
      intro: "",
      selected: [{ case_no: "2023므10519", match: "direct" }],
    });
    envelope.recordSelectionDiagnostic({
      selection: { intro: "", selected: [{ case_no: "2023므10519", match: "direct" }] },
      gated,
      continuationCount: 0,
    });
    const state = envelope.state();
    assert.equal(state.observed.length, 1);
    assert.equal(state.verified.length, 1);
    assert.equal(state.selectable.length, 1);
    assert.equal(state.detail_attempts[0].verified, true);
    assert.equal(state.provenance.provider, "common-envelope-fixture");
    assert.deepEqual(gated.selection_repair_reasons, []);
    assert.deepEqual(commonEvidenceState(ledger), state);
    assert.equal(canonicalCaseIdentity("서울가정법원-2023-므-10519"), "2023므10519");
  });

  test("Luna adapter receives the common envelope contract", async () => {
    const sessionFactory = async () => {
      let searched = false;
      return {
        async next() {
          if (!searched) {
            searched = true;
            const args = { domain: "precedent", query: "공통 evidence fixture" };
            return { type: "mcp_tool_call", delegated: false, name: "search_decisions", arguments: args, call_id: "search-1" };
          }
          return { type: "final", selection: { selected: [], intro: "" } };
        },
        async respondToToolCall() {},
        async close() {},
      };
    };
    const search = createAgenticSearchV2({
      provider: "codex_luna",
      gatewayOptions: { callTool: async () => ({ items: [] }) },
      adapterOptions: { createSession: sessionFactory },
    });
    let context;
    const contextAdapter = createLunaNativeAdapter({
      createSearch: () => ({
        async runWithContext(...args) {
          context = await search.runWithContext(...args);
          return context;
        },
      }),
    });
    await contextAdapter.runNaturalQuery("공통 evidence fixture");
    const envelope = context?.envelope;
    assert.equal(typeof envelope?.state, "function");
    const keys = Object.keys(envelope.state()).sort();
    assert.deepEqual(keys, ["detail_attempts", "observed", "provenance", "rejected", "selectable", "verification_failures", "verified"]);
  });
})();

// Consolidated from test/coreTrust.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { createEvidenceLedger, parseProviderCompoundCaseNumber } = await import("../../src/aoV2/evidenceLedger.js");
  const { finalizeSelection } = await import("../../src/aoV2/finalSelectionGate.js");
  const { createLegalToolGateway, LEGAL_TOOL_NAMES } = await import("../../src/aoV2/legalToolGateway.js");
  const { classifyLegalResult, LEGAL_RESULT_CATEGORIES } = await import("../../src/legalResultClassifier.js");
  const { caseNumberMatches } = await import("../../src/router.js");
  function verifiedLedger() {
    const ledger = createEvidenceLedger({ provider: "core-trust" });
    ledger.recordDecisionSearch({
      domain: "precedent",
      query: "fixture",
      items: [{ id: "d1", caseNumber: "2020다1234" }],
    });
    ledger.recordDecisionDetail({
      domain: "precedent",
      id: "d1",
      caseNumber: "2020다1234",
      rawText: "provider decision text",
    });
    return ledger;
  }

  test("final selection allows only observed and detail-verified cases", () => {
    const ledger = verifiedLedger();
    const accepted = finalizeSelection({ intro: "", selected: [{ case_no: "2020다1234", match: "direct" }] }, ledger);
    const unobserved = finalizeSelection({ intro: "", selected: [{ case_no: "2020다9999", match: "direct" }] }, ledger);

    assert.deepEqual(accepted.selected.map((item) => item.case_no), ["2020다1234"]);
    assert.equal(unobserved.rejectedSelected[0].reason, "CASE_NOT_OBSERVED");
  });

  test("unverified detail cannot enter the final result", () => {
    const ledger = createEvidenceLedger({ provider: "core-trust-unverified" });
    ledger.recordDecisionSearch({
      domain: "precedent",
      query: "fixture",
      items: [{ id: "d2", caseNumber: "2021다2345" }],
    });
    const result = finalizeSelection({ intro: "", selected: [{ case_no: "2021다2345", match: "related" }] }, ledger);
    assert.equal(result.selected.length, 0);
    assert.equal(result.rejectedSelected[0].reason, "NOT_DETAIL_VERIFIED");
  });

  test("compound identities remain provider-bound and two-digit years are not expanded", () => {
    const parsed = parseProviderCompoundCaseNumber("2014두12598, 12604");
    assert.deepEqual(parsed.canonicalMembers, ["2014두12598", "2014두12604"]);
    assert.equal(caseNumberMatches("2014두12598, 12604", "2014두12604"), true);
    assert.equal(caseNumberMatches("99두963", "1999두963"), false);
  });

  test("restricted legal MCP surface contains exactly the four allowed tools", () => {
    const gateway = createLegalToolGateway();
    assert.deepEqual(gateway.toolNames(), [...LEGAL_TOOL_NAMES]);
    assert.deepEqual(LEGAL_TOOL_NAMES, [
      "search_decisions",
      "search_law",
      "get_decision_text",
      "get_law_text",
    ]);
  });

  test("definitive NOT_FOUND search remains an error but records a completed search trace", async () => {
    const ledger = createEvidenceLedger({ provider: "not-found-trace" });
    const gateway = createLegalToolGateway({
      ledger,
      callTool: async () => ({ isError: true, content: [{ type: "text", text: "[NOT_FOUND]" }] }),
    });

    const result = await gateway.execute("search_decisions", { domain: "precedent", query: "not found fixture" });

    assert.equal(result.isError, true);
    assert.equal(result.category, LEGAL_RESULT_CATEGORIES.NOT_FOUND);
    assert.equal(result.notFound, true);
    assert.equal(result.hallucinationDetected, false);
    assert.equal(result.searchCompleted, true);
    assert.equal(ledger.snapshot().searchTraces.length, 1);
  });

  test("legal result categories distinguish success, sentinels, provider errors, and invalid payloads", () => {
    assert.equal(classifyLegalResult({ items: [] }, { toolName: "search_decisions" }), LEGAL_RESULT_CATEGORIES.SUCCESS);
    assert.equal(classifyLegalResult({ rawText: "[NOT_FOUND]" }, { toolName: "search_decisions" }), LEGAL_RESULT_CATEGORIES.NOT_FOUND);
    assert.equal(classifyLegalResult({ isError: true, rawText: "[HALLUCINATION_DETECTED]" }, { toolName: "search_decisions" }), LEGAL_RESULT_CATEGORIES.HALLUCINATION);
    assert.equal(classifyLegalResult({ isError: true, rawText: "provider unavailable" }, { toolName: "search_decisions" }), LEGAL_RESULT_CATEGORIES.PROVIDER_ERROR);
    assert.equal(classifyLegalResult({}, { toolName: "search_decisions" }), LEGAL_RESULT_CATEGORIES.INVALID);
  });

  test("empty or structurally invalid search responses are not completed searches", async () => {
    for (const raw of [{}, { content: [] }, { content: [{ type: "image", data: "fixture" }] }]) {
      const gateway = createLegalToolGateway({
        callTool: async () => raw,
      });
      const normalized = await gateway.execute("search_decisions", { domain: "precedent", query: "empty response" });
      assert.equal(normalized.category, LEGAL_RESULT_CATEGORIES.INVALID);
      assert.equal(normalized.searchCompleted, false);
    }
  });

  test("explicit empty search payload is a completed search", async () => {
    const gateway = createLegalToolGateway({
      callTool: async () => ({ items: [] }),
    });
    const result = await gateway.execute("search_decisions", { domain: "precedent", query: "empty payload" });
    assert.equal(result.searchCompleted, true);
    assert.equal(result.total, 0);
  });
})();

// Consolidated from test/evidenceLedgerClaims.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { createEvidenceLedger } = await import("../../src/aoV2/evidenceLedger.js");
  const { finalizeSelection } = await import("../../src/aoV2/finalSelectionGate.js");
  test("verified case evidence stays runtime-only and claim ledger records it", () => {
    const ledger = createEvidenceLedger({ provider: "claims-case-fixture" });
    ledger.recordDecisionSearch({
      domain: "precedent",
      query: "claims",
      items: [{ id: "provider-case", caseNumber: "2020\uB2E412345" }],
    });
    ledger.recordDecisionDetail({
      domain: "precedent",
      id: "provider-case",
      caseNumber: "2020\uB2E412345",
      rawText: "verified provider text",
    });

    const gated = finalizeSelection({
      selected: [{ case_no: "2020\uB2E412345", match: "direct" }],
      intro: "",
    }, ledger);
    const snapshot = ledger.snapshot();

    assert.equal(gated.selected.length, 1);
    assert.equal(snapshot.cases[0].rawText, undefined);
    assert.match(snapshot.cases[0].detailDigest, /^[0-9a-f]{64}$/u);
    assert.ok(snapshot.claimReferences.some((claim) =>
      claim.claimType === "case" && claim.normalizedReference === "2020\uB2E412345" && claim.status === "verified"));
  });

  test("law claims stay scoped when different laws share an article number", () => {
    const ledger = createEvidenceLedger({ provider: "claims-law-fixture" });
    ledger.recordLawSearch({
      query: "law",
      items: [
        { title: "\uBBFC\uBC95", lawId: "civil", mst: "m1" },
        { title: "\uC0C1\uBC95", lawId: "commercial", mst: "m2" },
      ],
    });
    ledger.recordLawText({ mst: "m1", jo: "\uC81C312\uC870" });

    const gated = finalizeSelection({
      selected: [],
      intro: "\uC0C1\uBC95 \uC81C312\uC870\uC5D0 \uB530\uB974\uBA74 \uACC4\uC57D\uC744 \uC124\uBA85\uD560 \uC218 \uC788\uC5B4\uC694.",
    }, ledger);
    const claim = ledger.snapshot().claimReferences.find((item) => item.lawName === "\uC0C1\uBC95");

    assert.equal(gated.intro, "");
    assert.ok(gated.protocolDiagnostics.some((item) => item.code === "INTRO_UNVERIFIED_LAW_ARTICLE_REMOVED"));
    assert.equal(claim?.status, "removed");
    assert.equal(claim?.reason, "LAW_ARTICLE_NOT_OPENED");
  });
})();
