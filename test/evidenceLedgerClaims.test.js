import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { finalizeSelection } from "../src/aoV2/finalSelectionGate.js";

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
