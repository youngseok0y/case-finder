import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config.js";
import { ADMIN_SETTING_KEYS, validateAdminPatch } from "../src/adminConfig.js";
import {
  createSearchAdapterRegistry,
  GEMINI_D_EXECUTION_PIN,
  LUNA_NATIVE_EXECUTION_PIN,
  SearchAdapterUnsupportedError,
  SEARCH_ADAPTER_IDS,
  toResultContract,
} from "../src/searchAdapters/index.js";
import { validateNaturalResult } from "../src/validator.js";

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
