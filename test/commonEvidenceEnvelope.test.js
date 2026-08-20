import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalCaseIdentity,
  caseIdentityMatches,
  commonEvidenceState,
  createCommonEvidenceEnvelope,
} from "../src/aoV2/commonEvidenceEnvelope.js";
import { createEvidenceLedger, parseProviderCompoundCaseNumber } from "../src/aoV2/evidenceLedger.js";
import { parseCaseNumber } from "../src/router.js";
import { createAgenticSearchV2 } from "../src/aoV2/index.js";
import { createLunaNativeAdapter } from "../src/searchAdapters/lunaNativeAdapter.js";

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
  }).result.verified, false);
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
  const sessionFactory = async () => ({
    async next() {
      return { type: "final", selection: { selected: [], intro: "" } };
    },
    async close() {},
  });
  const search = createAgenticSearchV2({
    provider: "codex_luna",
    adapterOptions: { createSession: sessionFactory },
  });
  const adapter = createLunaNativeAdapter({ createSearch: () => search });
  await adapter.runNaturalQuery("공통 evidence fixture");
  const envelope = search.lastRun?.envelope;
  assert.equal(typeof envelope?.state, "function");
  const keys = Object.keys(envelope.state()).sort();
  assert.deepEqual(keys, ["detail_attempts", "observed", "provenance", "rejected", "selectable", "verification_failures", "verified"]);
});
