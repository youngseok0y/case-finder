import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { createCodexNativeAo } from "../src/aoV2/providers/codexNativeAo.js";
import { isLunaTerraFallback, normalizeModelResolution } from "../src/codexAppServerRuntime.js";
import { createProgressReporter } from "../src/progress.js";
import { toResultContract } from "../src/searchAdapters/resultContract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("F1 actual Luna to Terra resolution emits fallback metadata", () => {
  const resolution = normalizeModelResolution({
    modelResolution: {
      requestedModel: "gpt-5.6-luna",
      effectiveModel: "gpt-5.6-terra",
      fallbackApplied: true,
    },
  }, "gpt-5.6-luna");
  assert.equal(isLunaTerraFallback(resolution), true);
  const events = [];
  const progress = createProgressReporter((event) => events.push(event));
  progress.emit("MODEL_FALLBACK", {
    fallbackApplied: true,
    requestedModel: resolution.requestedModel,
    effectiveModel: resolution.effectiveModel,
  });
  assert.deepEqual(events.at(-1), {
    event: "MODEL_FALLBACK",
    label: "사용 가능한 모델로 검색을 이어가고 있습니다.",
    percent: 90,
    route: "",
    route_reason: null,
    candidate_raw: null,
    candidate_normalized: null,
    candidate_case_code: null,
    candidate_rejection_reason: null,
    candidateCount: 0,
    verifiedCount: 0,
    lawCount: 0,
    fallbackApplied: true,
    requestedModel: "gpt-5.6-luna",
    effectiveModel: "gpt-5.6-terra",
  });
});

test("F1 AO session forwards authoritative fallback as MODEL_FALLBACK", async () => {
  const ledger = createEvidenceLedger({ provider: "fallback-fixture" });
  const events = [];
  const ao = createCodexNativeAo({
    gateway: { ledger, execute: async () => ({ items: [], searchCompleted: true }) },
    createSession: async () => {
      let searched = false;
      return {
      async next() {
        if (!searched) {
          searched = true;
          const args = { domain: "precedent", query: "fallback fixture" };
          return { type: "mcp_tool_call", delegated: false, name: "search_decisions", arguments: args, call_id: "search-1" };
        }
        return {
          type: "final",
          selection: { selected: [], intro: "" },
          modelResolution: {
            requestedModel: "gpt-5.6-luna",
            effectiveModel: "gpt-5.6-terra",
            fallbackApplied: true,
          },
        };
      },
      async respondToToolCall() {},
      async close() {},
      };
    },
  });
  const result = await ao.run("fallback fixture", { onProgress: (event) => events.push(event) });
  assert.equal(result.modelResolution.fallbackApplied, true);
  assert.equal(events.includes("MODEL_FALLBACK"), true);
});

test("F2 free plan without actual fallback does not satisfy the toast condition", () => {
  const resolution = normalizeModelResolution({
    modelResolution: {
      requestedModel: "gpt-5.6-luna",
      effectiveModel: "gpt-5.6-luna",
      fallbackApplied: false,
    },
  }, "gpt-5.6-luna");
  assert.equal(isLunaTerraFallback({ ...resolution, planType: "free" }), false);
});

test("F3 Pro plan with actual Luna to Terra resolution satisfies the toast condition", () => {
  const resolution = normalizeModelResolution({
    requestedModel: "gpt-5.6-luna",
    effectiveModel: "gpt-5.6-terra",
    fallbackApplied: true,
  }, "gpt-5.6-luna");
  assert.equal(isLunaTerraFallback({ ...resolution, planType: "pro" }), true);
  const result = toResultContract({
    query: "fallback fixture",
    selected: [],
    items: [],
    candidateCaseNumbers: [],
    modelResolution: resolution,
  }, { adapterId: "luna_native", provider: "codex_luna", architecture: "AO_V2_NATIVE" });
  assert.deepEqual(result.modelResolution, {
    requestedModel: "gpt-5.6-luna",
    effectiveModel: "gpt-5.6-terra",
    fallbackApplied: true,
  });
});

test("Admin and Index operating UI consume the shared dynamic quota fields", async () => {
  const [adminHtml, adminJs, indexHtml, appJs] = await Promise.all([
    fs.readFile(path.join(ROOT, "public", "admin.html"), "utf8"),
    fs.readFile(path.join(ROOT, "public", "admin.js"), "utf8"),
    fs.readFile(path.join(ROOT, "public", "index.html"), "utf8"),
    fs.readFile(path.join(ROOT, "public", "app.js"), "utf8"),
  ]);
  assert.match(adminHtml, /연결된 계정/u);
  assert.match(adminHtml, /<dt>사용량<\/dt>/u);
  assert.doesNotMatch(adminHtml, /이번 주 사용량/u);
  assert.match(adminHtml, /다음 초기화/u);
  assert.doesNotMatch(adminHtml, /로컬 token usage/iu);
  assert.doesNotMatch(adminHtml, /rate limit/iu);
  assert.match(adminJs, /fetch\("\/api\/codex\/account"/u);
  assert.match(adminJs, /quota\.resetLabel/u);
  assert.match(adminJs, /quota\.windowLabel/u);
  assert.match(adminJs, /window\.open\("", "codex-login"/u);
  assert.doesNotMatch(adminJs, /\/api\/codex\/(usage|rate-limits)/u);
  assert.doesNotMatch(adminJs, /resetsAt|43200분|300분|input_tokens|reasoning_tokens/iu);
  assert.match(indexHtml, /Codex 사용량/u);
  assert.doesNotMatch(indexHtml, /Codex 주간 사용량/u);
  assert.match(indexHtml, /id="toast"/u);
  assert.match(appJs, /payload\?\.fallbackApplied !== true/u);
  assert.match(appJs, /payload\?\.requestedModel !== "gpt-5\.6-luna"/u);
  assert.match(appJs, /payload\?\.effectiveModel !== "gpt-5\.6-terra"/u);
  assert.doesNotMatch(appJs, /payload\.quota\?\.luna/iu);
  assert.doesNotMatch(appJs, /planType.*free/iu);
});

test("progress copy and search examples use the approved user-facing wording", async () => {
  const [indexHtml, appJs] = await Promise.all([
    fs.readFile(path.join(ROOT, "public", "index.html"), "utf8"),
    fs.readFile(path.join(ROOT, "public", "app.js"), "utf8"),
  ]);
  const events = [];
  createProgressReporter((event) => events.push(event)).emit("LAW_EVIDENCE_UPDATED");
  assert.equal(events[0].label, "법령 근거 확인 중");
  assert.equal(events[0].percent, 40);
  assert.match(indexHtml, /data-example="2014헌나8"/u);
  assert.doesNotMatch(indexHtml, /2020다12345/u);
  assert.match(appJs, /terminalState === "NO_RESULT"/u);
  assert.match(appJs, /data-action="retry"/u);
  assert.match(appJs, /addRelatedHint/u);
});
