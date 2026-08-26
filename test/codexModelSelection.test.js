import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createAgenticSearchV2 } from "../src/aoV2/index.js";
import { normalizeModelResolution } from "../src/codexAppServerRuntime.js";
import { createLunaNativeAdapter } from "../src/searchAdapters/lunaNativeAdapter.js";
import { selectCodexModel } from "../src/codexModelSelection.js";

test("Codex plan model policy selects Terra only for Free and Go", () => {
  const terraPlans = ["free", "go"];
  const lunaPlans = ["plus", "pro", "business", "enterprise", "unknown", "", null, undefined];
  for (const planType of terraPlans) assert.equal(selectCodexModel(planType), "gpt-5.6-terra");
  for (const planType of lunaPlans) assert.equal(selectCodexModel(planType), "gpt-5.6-luna");
});

test("selected plan model reaches telemetry and execution metadata", async () => {
  async function captureModel(planType, effectiveModel = null) {
    const captured = {};
    const progressEvents = [];
    const search = createAgenticSearchV2({
      provider: "codex_luna",
      gatewayOptions: { callTool: async () => ({ items: [] }) },
      adapterOptions: {
        createSession: async ({ model }) => {
          captured.model = model;
          let searched = false;
          return {
            async next() {
              if (!searched) {
                searched = true;
                const args = { domain: "precedent", query: "model selection fixture" };
                return { type: "mcp_tool_call", delegated: false, name: "search_decisions", arguments: args, call_id: "search-1" };
              }
              return {
                type: "final",
                selection: { selected: [], intro: "" },
                modelResolution: {
                  requestedModel: model,
                  effectiveModel: effectiveModel || model,
                  fallbackApplied: false,
                },
              };
            },
            async respondToToolCall() {},
            async close() {},
          };
        },
      },
    });
    const adapter = createLunaNativeAdapter({
      accountManager: { read: async () => ({ planType }) },
      createSearch: () => search,
    });
    const result = await adapter.runNaturalQuery("model selection fixture", {
      onProgress: (event) => progressEvents.push(event),
    });
    return { model: captured.model, result, progressEvents };
  }

  for (const planType of ["free", "go"]) {
    const execution = await captureModel(planType);
    assert.equal(execution.model, "gpt-5.6-terra");
    assert.equal(execution.result.executionPin.model, "gpt-5.6-terra");
    assert.equal(execution.result.telemetry.model, "gpt-5.6-terra");
    assert.deepEqual(execution.result.modelResolution, {
      requestedModel: "gpt-5.6-terra",
      effectiveModel: "gpt-5.6-terra",
      fallbackApplied: false,
    });
  }
  const plusExecution = await captureModel("plus");
  assert.equal(plusExecution.model, "gpt-5.6-luna");
  assert.equal(plusExecution.result.executionPin.model, "gpt-5.6-luna");
  assert.equal(plusExecution.result.telemetry.model, "gpt-5.6-luna");

  const fallbackExecution = await captureModel("plus", "gpt-5.6-terra");
  assert.deepEqual(fallbackExecution.result.modelResolution, {
    requestedModel: "gpt-5.6-luna",
    effectiveModel: "gpt-5.6-terra",
    fallbackApplied: true,
  });
  assert.equal(fallbackExecution.result.telemetry.model, "gpt-5.6-luna");
  assert.equal(fallbackExecution.result.executionPin.model, "gpt-5.6-luna");
  assert.equal(fallbackExecution.progressEvents.includes("MODEL_FALLBACK"), true);
});

test("fallbackApplied is true only when requested and effective models differ", () => {
  const freeResolution = normalizeModelResolution({
    modelResolution: {
      requestedModel: "gpt-5.6-terra",
      effectiveModel: "gpt-5.6-terra",
      fallbackApplied: true,
    },
  }, "gpt-5.6-terra");
  assert.equal(freeResolution.fallbackApplied, false);

  const plusResolution = normalizeModelResolution({
    modelResolution: {
      requestedModel: "gpt-5.6-luna",
      effectiveModel: "gpt-5.6-terra",
      fallbackApplied: false,
    },
  }, "gpt-5.6-luna");
  assert.equal(plusResolution.fallbackApplied, true);
});

test("Codex runtime and session remain independent of plan policy", async () => {
  const [runtime, session] = await Promise.all([
    fs.readFile(new URL("../src/codexAppServerRuntime.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/codexAppServerSession.js", import.meta.url), "utf8"),
  ]);
  for (const source of [runtime, session]) {
    assert.doesNotMatch(source, /planType|CodexAccountManager|selectCodexModel/iu);
  }
});
