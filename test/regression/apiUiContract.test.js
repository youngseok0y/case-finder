// Consolidated from test/codexApi.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const http = (await import("node:http")).default;
  const test = (await import("node:test")).default;
  const { createRequestHandler, healthPayload } = await import("../../src/server.js");
  function listen(server) {
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  }

  function close(server) {
    return new Promise((resolve) => server.close(() => resolve()));
  }

  test("Codex account and usage routes expose safe app-server metadata", async () => {
    const calls = [];
    const account = {
      loggedIn: true,
      requiresOpenaiAuth: true,
      email: "user@example.com",
      planType: "pro",
      type: "chatgpt",
      authMode: "chatgpt",
      codexQuota: {
        available: true,
        usedPercent: 37,
        remainingPercent: 63,
        windowDurationMins: 10080,
        windowKind: "weekly",
        windowLabel: "주간",
        resetsAt: 1789889511,
        resetLabel: "2026년 8월 28일 오후 3:20",
      },
    };
    const manager = {
      async read() { calls.push("read"); return account; },
      async readRateLimits() { calls.push("rate"); return { source: "app_server", codexQuota: account.codexQuota }; },
      async startLogin(type) { calls.push(`login:${type}`); return { type, loginId: "login-1", authUrl: "https://example.test/login", source: "app_server" }; },
      async cancelLogin(loginId) { calls.push(`cancel:${loginId}`); return { cancelled: true, source: "app_server" }; },
      async logout() { calls.push("logout"); return { loggedIn: false, requiresOpenaiAuth: true, email: "", planType: "unknown", type: "", authMode: "logged_out" }; },
    };
    const runtime = {
      async usageSnapshot() {
        return {
          source: "local_kst_aggregate",
          usage: null,
          usage_source: "unavailable",
          local: { date: "2026-08-21", runs: 2, totalTokens: 0 },
        };
      },
    };
    const server = http.createServer(createRequestHandler({
      codexRuntimeImpl: () => runtime,
      codexAccountManagerImpl: () => manager,
    }));
    const port = await listen(server);
    try {
      const accountResponse = await fetch(`http://127.0.0.1:${port}/api/codex/account`);
      const accountBody = await accountResponse.json();
      assert.equal(accountResponse.status, 200);
      assert.equal(accountBody.email, "user@example.com");
      assert.equal("accessToken" in accountBody, false);
      assert.equal(accountBody.codexQuota.remainingPercent, 63);
      assert.equal(accountBody.codexQuota.windowDurationMins, 10080);
      assert.equal(accountBody.codexQuota.windowLabel, "주간");
      assert.equal("resetsAt" in accountBody.codexQuota, false);

      const usageResponse = await fetch(`http://127.0.0.1:${port}/api/codex/usage`);
      const usageBody = await usageResponse.json();
      assert.equal(usageBody.local.runs, 2);

      const rateResponse = await fetch(`http://127.0.0.1:${port}/api/codex/rate-limits`);
      const rateBody = await rateResponse.json();
      assert.equal(rateBody.codexQuota.remainingPercent, 63);
      assert.equal(rateBody.codexQuota.windowKind, "weekly");
      assert.equal("limits" in rateBody, false);

      const loginResponse = await fetch(`http://127.0.0.1:${port}/api/codex/login/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "chatgpt" }),
      });
      assert.equal((await loginResponse.json()).loginId, "login-1");

      const cancelResponse = await fetch(`http://127.0.0.1:${port}/api/codex/login/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginId: "login-1" }),
      });
      assert.equal((await cancelResponse.json()).cancelled, true);

      const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/codex/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal((await logoutResponse.json()).authMode, "logged_out");
      assert.equal(calls.includes("rate"), true);
    } finally {
      await close(server);
    }
  });

  test("public health exposes only normalized Codex quota status, never account email", async () => {
    const manager = {
      async read() {
        return {
          loggedIn: true,
          email: "user@example.com",
          codexQuota: { available: true, remainingPercent: 63, windowKind: "monthly", windowLabel: "월간" },
        };
      },
    };
    const health = await healthPayload({
      codexAccountManagerImpl: () => manager,
      codexRuntimeImpl: () => ({ inspect: async () => ({ available: true, transport: "app_server" }) }),
    });
    assert.equal(health.quota.codexQuota.available, true);
    assert.equal(health.quota.codexQuota.remainingPercent, 63);
    assert.equal(health.quota.codexQuota.windowKind, "monthly");
    assert.equal(health.quota.codexQuota.windowLabel, "월간");
    assert.equal("email" in health, false);
    assert.equal("email" in health.quota.codexQuota, false);
  });

  test("Gemini health does not instantiate Codex account or runtime state", async () => {
    let accountFactoryCalls = 0;
    let runtimeInspectCalls = 0;
    const health = await healthPayload({
      searchAdapter: "gemini_d",
      codexAccountManagerImpl: () => {
        accountFactoryCalls += 1;
        throw new Error("Codex account must stay dormant for Gemini health");
      },
      codexRuntimeImpl: () => ({
        inspect: async () => {
          runtimeInspectCalls += 1;
          throw new Error("Codex runtime must stay dormant for Gemini health");
        },
      }),
    });
    assert.equal(accountFactoryCalls, 0);
    assert.equal(runtimeInspectCalls, 0);
    assert.equal(health.adapter.id, "gemini_d");
    assert.equal(health.codex.codexAvailable, false);
    assert.equal(health.quota.codexQuota.loggedIn, false);
  });

  test("future Codex app-server errors use the unavailable runtime response", async () => {
    const server = http.createServer(createRequestHandler({
      codexAccountManagerImpl: () => ({
        async read() {
          throw Object.assign(new Error("future runtime"), { code: "CODEX_APP_SERVER_FUTURE_FAILURE" });
        },
      }),
    }));
    const port = await listen(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/codex/account`);
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.code, "CODEX_APP_SERVER_FUTURE_FAILURE");
      assert.match(body.message, /app-server/iu);
    } finally {
      await close(server);
    }
  });
})();

// Consolidated from test/authWeeklyQuotaFallbackUx.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const fs = (await import("node:fs/promises")).default;
  const path = (await import("node:path")).default;
  const test = (await import("node:test")).default;
  const { fileURLToPath } = await import("node:url");
  const { createEvidenceLedger } = await import("../../src/aoV2/evidenceLedger.js");
  const { createCodexNativeAo } = await import("../../src/aoV2/providers/codexNativeAo.js");
  const { isLunaTerraFallback, normalizeModelResolution } = await import("../../src/codexAppServerRuntime.js");
  const { createProgressReporter } = await import("../../src/progress.js");
  const { toResultContract } = await import("../../src/searchAdapters/resultContract.js");
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
    assert.doesNotMatch(adminHtml, /<option value="(?:gemini_d|luna_native)"/u);
    assert.match(adminHtml, /<dt>사용량<\/dt>/u);
    assert.doesNotMatch(adminHtml, /이번 주 사용량/u);
    assert.match(adminHtml, /다음 초기화/u);
    assert.doesNotMatch(adminHtml, /로컬 token usage/iu);
    assert.doesNotMatch(adminHtml, /rate limit/iu);
    assert.match(adminJs, /fetch\("\/api\/codex\/account"/u);
    assert.match(adminJs, /payload\.adapterOptions/u);
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
    assert.match(appJs, /const adapterId = payload\.adapter\?\.id/u);
    assert.match(appJs, /usageTitle = "Gemini 사용량"/u);
    assert.match(appJs, /payload\.quota\?\.gemini\?\.label/u);
    assert.match(appJs, /usageTitle = "Codex 사용량"/u);
    assert.match(appJs, /payload\.quota\?\.codexQuota/u);
    assert.match(appJs, /mcp\.providerReady === true/u);
    assert.match(appJs, /mcp\.ocConfigured === false/u);
    assert.match(appJs, /SEARCH_FAILED: "검색 검증에 실패했습니다"/u);
    assert.doesNotMatch(appJs, /SEARCH_FAILED: "원문 검증에 실패했습니다"/u);
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
})();

// Consolidated from test/userFacingSearchCopy.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { SEARCH_FAILED_MESSAGE } = await import("../../src/productMessages.js");
  const { renderResults } = await import("../../src/renderer.js");
  test("related-only result uses bounded search wording", () => {
    const html = renderResults({
      query: "관련 판례 질문",
      terminalState: "SUCCESS",
      items: [{
        status: "verified",
        caseNumber: "2024다00001",
        match: "related",
        title: "관련 사건",
        court: "대법원",
        date: "20240101",
        detail: { sections: { 판시사항: "관련 법리" } },
      }],
      lawReferences: [],
    });

    assert.match(html, /현재 검색 결과에서 질문과 직접 일치하는 판례는 확인되지 않았습니다/u);
    assert.doesNotMatch(html, /질문과 정확히 일치하는 판례는 없습니다/u);
  });

  test("search failure copy covers both search and detail verification", () => {
    const html = renderResults({
      query: "검색 실패 질문",
      terminalState: "SEARCH_FAILED",
      items: [],
      lawReferences: [],
    });

    assert.equal(SEARCH_FAILED_MESSAGE, "판례 검색 또는 원문 검증 과정에서 오류가 발생해 결과를 표시하지 않았습니다. 다시 검색하거나 잠시 후 다시 시도해 주세요.");
    assert.match(html, /검색 검증에 실패했습니다/u);
    assert.match(html, /판례 검색 또는 원문 검증 과정에서 오류가 발생해 결과를 표시하지 않았습니다/u);
  });
})();
