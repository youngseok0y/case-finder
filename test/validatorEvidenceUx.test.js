import assert from "node:assert/strict";
import test from "node:test";
import { createCodexNativeAo } from "../src/aoV2/providers/codexNativeAo.js";
import { createLegalToolGateway } from "../src/aoV2/legalToolGateway.js";
import { createEvidenceLedger, providerBoundCaseIdentityCompatibility } from "../src/aoV2/evidenceLedger.js";
import { finalizeSelection } from "../src/aoV2/finalSelectionGate.js";
import { lawDetailLink } from "../src/directLookup.js";
import { renderResults } from "../src/renderer.js";
import { validateNaturalResult } from "../src/validator.js";

function verifiedLedger() {
  const ledger = createEvidenceLedger({ provider: "validator-ux-fixture" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "validator fixture",
    items: [{ id: "case-2017", caseNumber: "2017다35588" }],
  });
  ledger.recordDecisionDetail({
    domain: "precedent",
    id: "case-2017",
    caseNumber: "2017다35588",
    rawText: "provider decision text",
  });
  return ledger;
}

test("T1 verified case reference remains in intro and stays protocol-clean", async () => {
  const ledger = verifiedLedger();
  const gated = finalizeSelection({
    selected: [{ case_no: "2017다35588", match: "direct" }],
    intro: "대법원 2017다35588 판결은 이 쟁점을 설명해요.",
  }, ledger);
  assert.equal(gated.intro, "대법원 2017다35588 판결은 이 쟁점을 설명해요.");
  assert.equal(gated.model_protocol_clean, true);
  assert.equal(gated.protocolPass, true);
  assert.deepEqual(gated.protocolDiagnostics, []);

  const validated = await validateNaturalResult({
    query: "validator fixture",
    intro: gated.intro,
    selected: [{ caseNumber: "2017다35588", match: "direct" }],
    items: [{
      status: "verified",
      caseNumber: "2017다35588",
      detail: { caseNumber: "2017다35588", rawText: "provider decision text" },
    }],
    candidateCaseNumbers: ["2017다35588"],
    lawReferences: [],
  });
  assert.equal(validated.intro, gated.intro);
  assert.equal(validated.items.length, 1);
});

test("T2 unverified case reference is sanitized without becoming a runtime failure", async () => {
  const validated = await validateNaturalResult({
    query: "unverified intro fixture",
    intro: "대법원 2025다999999 판결은 이 쟁점을 설명해요.",
    selected: [],
    items: [],
    candidateCaseNumbers: [],
    lawReferences: [],
  });
  assert.equal(validated.intro, "");
  assert.equal(validated.terminalState, "NO_RESULT");
  assert.equal(validated.selectionRepaired, true);
  assert.equal(validated.protocolDiagnostics[0].code, "INTRO_UNVERIFIED_CASE_REFERENCE_REMOVED");

  const unknownCode = await validateNaturalResult({
    query: "unknown provider code fixture",
    intro: "2027새12345 판결은 확인되지 않았어요.",
    selected: [],
    items: [],
    candidateCaseNumbers: [],
    lawReferences: [],
  });
  assert.equal(unknownCode.intro, "");
});

test("T3 opened law article remains in intro", async () => {
  const ledger = createEvidenceLedger({ provider: "law-article-fixture" });
  const calls = [];
  const gateway = createLegalToolGateway({
    ledger,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === "search_law") {
        return { content: [{ type: "text", text: "1. 민법 [현행]\nMST: 284415" }] };
      }
      return { content: [{ type: "text", text: "제312조\n전세권의 존속기간은 10년을 넘지 못한다." }] };
    },
  });
  await gateway.execute("search_law", { query: "민법" });
  await gateway.execute("get_law_text", { mst: "284415", jo: "제312조" });
  const gated = finalizeSelection({ selected: [], intro: "민법 제312조에 따르면 전세권 존속기간을 설명할 수 있어요." }, ledger);
  assert.equal(calls[1].args.jo, "제312조");
  assert.equal(ledger.isLawArticleOpened({ mst: "284415", article: "제312조" }), true);
  assert.match(gated.intro, /제312조/u);
  assert.equal(gated.protocolDiagnostics.length, 0);
});

test("T4 unopened law article is sanitized", () => {
  const ledger = createEvidenceLedger({ provider: "unopened-law-fixture" });
  ledger.recordLawSearch({ query: "민법", items: [{ title: "민법", mst: "284415" }] });
  const gated = finalizeSelection({ selected: [], intro: "민법 제999조에 따르면 전세권 존속기간을 설명할 수 있어요." }, ledger);
  assert.equal(gated.intro, "");
  assert.equal(gated.protocolDiagnostics[0].code, "INTRO_UNVERIFIED_LAW_ARTICLE_REMOVED");
  assert.equal(gated.model_protocol_clean, true);
});

test("T5 same-provider single search and compound detail verify through expansion", () => {
  const ledger = createEvidenceLedger({ provider: "compound-fixture" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "compound fixture",
    items: [{ id: "provider-X", caseNumber: "2017다35588" }],
  });
  const detail = ledger.recordDecisionDetail({
    domain: "precedent",
    id: "provider-X",
    caseNumber: "2017다35588, 35595",
    rawText: "provider compound decision text",
  });
  assert.equal(providerBoundCaseIdentityCompatibility("2017다35588", "2017다35588, 35595"), "provider_compound_expansion");
  assert.equal(detail.verified, true);
  assert.deepEqual(ledger.getCase("2017다35588, 35595").canonicalMembers, ["2017다35588", "2017다35595"]);
  const gated = finalizeSelection({ selected: [{ case_no: "2017다35588, 35595", match: "direct" }], intro: "" }, ledger);
  assert.equal(gated.selected.length, 1);
});

test("T6 unrelated same-provider compound remains rejected", () => {
  const ledger = createEvidenceLedger({ provider: "compound-mismatch-fixture" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "compound mismatch fixture",
    items: [{ id: "provider-X", caseNumber: "2017다35588" }],
  });
  const detail = ledger.recordDecisionDetail({
    domain: "precedent",
    id: "provider-X",
    caseNumber: "2018다99999, 100000",
    rawText: "provider unrelated compound text",
  });
  assert.equal(providerBoundCaseIdentityCompatibility("2017다35588", "2018다99999, 100000"), "mismatch");
  assert.equal(detail.verified, false);
  assert.equal(ledger.snapshot().verificationFailures[0].code, "DETAIL_IDENTITY_MISMATCH");
});

test("T7 NO_RESULT renders safe rationale and provider-backed law reference without case cards", () => {
  const html = renderResults({
    route: "natural",
    terminalState: "NO_RESULT",
    query: "전세권 존속기간",
    intro: "민법 제312조에 따르면 질문의 전제를 확인하기 어려워요.",
    lawReferences: [{
      lawName: "민법",
      article: "제312조",
      text: "전세권의 존속기간은 10년을 넘지 못한다.",
      link: lawDetailLink("284415", "제312조"),
    }],
    items: [],
  });
  assert.match(html, /민법 제312조에 따르면/u);
  assert.match(html, /관련 법규/u);
  assert.doesNotMatch(html, /case-card/u);
});

test("T8 actual AO runtime failure remains a thrown runtime failure", async () => {
  const ledger = createEvidenceLedger({ provider: "runtime-fixture" });
  const gateway = createLegalToolGateway({ ledger });
  const ao = createCodexNativeAo({
    gateway,
    ledger,
    createSession: async () => ({
      async next() {
        throw new Error("FAKE_PROCESS_FAILURE");
      },
      async close() {},
    }),
  });
  await assert.rejects(() => ao.run("runtime failure fixture"), /FAKE_PROCESS_FAILURE/u);
});
