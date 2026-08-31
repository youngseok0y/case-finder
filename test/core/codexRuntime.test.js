// Consolidated from test/appServerRuntime.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const { EventEmitter } = await import("node:events");
  const { Writable, PassThrough } = await import("node:stream");
  const test = (await import("node:test")).default;
  const fs = (await import("node:fs/promises")).default;
  const os = (await import("node:os")).default;
  const path = (await import("node:path")).default;
  const {
  CodexAppServerRuntime,
  parseFinalSelection,
} = await import("../../src/codexAppServerRuntime.js");
  const { CodexAppServerSession } = await import("../../src/codexAppServerSession.js");
  const { AppServerClient } = await import("../../src/codexAppServerClient.js");
  const { createCodexNativeAo } = await import("../../src/aoV2/providers/codexNativeAo.js");
  const {
  createCodexAccountManager,
  formatCodexQuotaWindowLabel,
  formatCodexResetLabel,
  normalizeCodexAccount,
  normalizeCodexQuota,
  normalizeCodexRateLimits,
  selectCodexQuotaWindow,
} = await import("../../src/codexAccount.js");
  const { createLegalDynamicTools, LEGAL_TOOL_NAMES } = await import("../../src/aoV2/legalToolDefinitions.js");
  const { createCodexUsageCollector, normalizeCodexTokenUsage } = await import("../../src/codexUsage.js");
  const { classifyCodexError, CODEX_ERROR_CATEGORIES } = await import("../../src/codexError.js");
  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.killed = false;
      this.requests = [];
      this.stdin = new Writable({
        write: (chunk, encoding, callback) => {
          const message = JSON.parse(String(chunk, encoding));
          this.requests.push(message);
          queueMicrotask(() => this.#handle(message));
          callback();
        },
      });
    }

    #send(message) {
      this.stdout.write(`${JSON.stringify(message)}\n`);
    }

    #handle(message) {
      if (message.method === "initialize") {
        this.#send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { experimentalApi: true } } });
        return;
      }
      if (message.method === "config/read") {
        this.#send({
          jsonrpc: "2.0",
          id: message.id,
          result: { config: { additional: { cli_auth_credentials_store: "file" } } },
        });
        return;
      }
      if (message.method === "thread/start") {
        this.#send({ jsonrpc: "2.0", id: message.id, result: { thread: { id: "thread-1" } } });
        return;
      }
      if (message.method === "turn/start") {
        this.#send({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-1" } } });
        queueMicrotask(() => this.#send({
          jsonrpc: "2.0",
          id: "server-call-1",
          method: "item/tool/call",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "call-1",
            tool: "search_decisions",
            arguments: { domain: "precedent", query: "fixture", display: 20 },
          },
        }));
        return;
      }
      if (message.id === "server-call-1") {
        assert.equal(message.result.success, true);
        this.#send({
          jsonrpc: "2.0",
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            tokenUsage: { inputTokens: 8, cachedInputTokens: 1, outputTokens: 2, reasoningOutputTokens: 2, totalTokens: 12 },
          },
        });
        this.#send({
          jsonrpc: "2.0",
          method: "thread/tokenUsage/updated",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            tokenUsage: {
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 4,
              reasoningOutputTokens: 3,
              totalTokens: 17,
            },
          },
        });
        this.#send({
          jsonrpc: "2.0",
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: {
              id: "turn-1",
              status: "completed",
              items: [{ type: "agentMessage", text: JSON.stringify({ selected: [], intro: "완료했어요." }) }],
            },
          },
        });
      }
    }

    kill() {
      this.killed = true;
      this.emit("exit", 0, null);
    }
  }

  test("app-server runtime preserves the AO session contract and routes dynamic tools", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-app-server-test-"));
    const child = new FakeChild();
    const collector = createCodexUsageCollector({ statePath: path.join(root, "state", "codex-usage.json") });
    const runtime = new CodexAppServerRuntime({
      baseDir: path.join(root, "sessions"),
      codexHomePath: path.join(root, "codex-home"),
      configCwd: root,
      resolveRuntime: async () => ({ executablePath: "fake-codex", packageName: "fake", target: "fake", version: "0.147.0" }),
      spawnImpl: () => child,
      usageCollector: collector,
      requestTimeoutMs: 2_000,
      sessionTimeoutMs: 2_000,
    });

    try {
      const session = await runtime.createSession({ prompt: "fixture prompt" });
      const call = await session.next();
      assert.deepEqual(call, {
        type: "tool_call",
        delegated: false,
        call_id: "call-1",
        name: "search_decisions",
        arguments: { domain: "precedent", query: "fixture", display: 20 },
      });
      await session.respondToToolCall({ callId: "call-1", result: { rawText: "provider result" } });
      const final = await session.next();
      assert.equal(final.type, "final");
      assert.deepEqual(final.selection, { selected: [], intro: "완료했어요." });
      assert.deepEqual(final.usage, {
        input_tokens: 10,
        cached_input_tokens: 2,
        output_tokens: 4,
        reasoning_tokens: 3,
        total_tokens: 17,
      });
      const usage = await collector.snapshot();
      assert.equal(usage.local.runs, 1);
      assert.equal(usage.local.totalTokens, 17);
      assert.equal(child.requests.filter((item) => item.method === "thread/start").length, 1);
      assert.equal(child.requests.filter((item) => item.method === "turn/start").length, 1);
      assert.deepEqual(child.requests.find((item) => item.id === "server-call-1").result, {
        contentItems: [{ type: "inputText", text: "provider result" }],
        success: true,
      });
      await session.close();
      assert.deepEqual(await fs.readdir(path.join(root, "sessions")), []);
    } finally {
      await runtime.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("runtime inspection metadata is resolved once and shared by concurrent health checks", async () => {
    let resolveCalls = 0;
    const runtime = new CodexAppServerRuntime({
      resolveRuntime: async () => {
        resolveCalls += 1;
        return { executablePath: "fake-codex", packageName: "fake", target: "fake", version: "0.147.0" };
      },
    });
    const [first, second] = await Promise.all([runtime.inspect(), runtime.inspect()]);
    assert.deepEqual(first, second);
    assert.equal(resolveCalls, 1);
    await runtime.inspect();
    assert.equal(resolveCalls, 1);
    await runtime.close();
  });

  test("usage persistence failure does not poison the queue or invalidate a completed answer", async () => {
    const files = new Map();
    let failWrites = 1;
    const fsImpl = {
      async readFile(file) {
        if (!files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return files.get(file);
      },
      async mkdir() {},
      async writeFile(file, text) {
        if (failWrites > 0) {
          failWrites -= 1;
          throw new Error("simulated usage write failure");
        }
        files.set(file, text);
      },
      async rename(from, to) {
        files.set(to, files.get(from));
        files.delete(from);
      },
      async rm(file) {
        files.delete(file);
      },
    };
    const collector = createCodexUsageCollector({
      statePath: "C:/case-finder-test/state/codex-usage.json",
      fsImpl,
      now: () => new Date("2026-08-28T00:00:00.000Z"),
    });
    await assert.rejects(() => collector.recordQuery({ total_tokens: 3 }), /simulated usage write failure/u);
    const recovered = await collector.recordQuery({ total_tokens: 5 });
    assert.equal(recovered.runs, 1);
    assert.equal(recovered.totalTokens, 5);

    const session = new CodexAppServerSession({
      unregisterSession() {},
      cleanupSessionDirectory: async () => {},
      interruptTurn: async () => {},
      recordSessionUsage: async () => { throw new Error("simulated usage write failure"); },
    }, {
      threadId: "thread-usage",
      turnId: "pending",
      sessionId: "session-usage",
      timeoutMs: 1_000,
      requestedModel: "gpt-5.6-luna",
    });
    session.setTurnId("turn-usage");
    await session.handleNotification({
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-usage",
          status: "completed",
          items: [{ type: "agentMessage", text: JSON.stringify({ selected: [] }) }],
        },
      },
    });
    assert.deepEqual((await session.next()).selection, { selected: [] });
    await session.close();
  });

  test("buffers turn completion until turn/start assigns the turn id", async () => {
    const session = new CodexAppServerSession({
      unregisterSession() {},
      cleanupSessionDirectory: async () => {},
      interruptTurn: async () => {},
      recordSessionUsage: async () => {},
    }, {
      threadId: "thread-early",
      turnId: "pending",
      sessionId: "session-early",
      timeoutMs: 1_000,
      requestedModel: "gpt-5.6-luna",
    });
    await session.handleNotification({
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-early",
          status: "completed",
          items: [{ type: "agentMessage", text: JSON.stringify({ selected: [], intro: "early" }) }],
        },
      },
    });
    session.setTurnId("turn-early");
    assert.deepEqual((await session.next()).selection, { selected: [], intro: "early" });
    await session.close();
  });

  test("duplicate turn completion is idempotent before usage persistence resolves", async () => {
    let releaseUsage;
    let usageCalls = 0;
    const usageGate = new Promise((resolve) => { releaseUsage = resolve; });
    const session = new CodexAppServerSession({
      unregisterSession() {},
      cleanupSessionDirectory: async () => {},
      interruptTurn: async () => {},
      recordSessionUsage: async () => {
        usageCalls += 1;
        await usageGate;
      },
    }, {
      threadId: "thread-duplicate",
      turnId: "turn-duplicate",
      sessionId: "session-duplicate",
      timeoutMs: 1_000,
      requestedModel: "gpt-5.6-luna",
    });
    const message = {
      method: "turn/completed",
      params: {
        turn: {
          id: "turn-duplicate",
          status: "completed",
          items: [{ type: "agentMessage", text: JSON.stringify({ selected: [] }) }],
        },
      },
    };
    const first = session.handleNotification(message);
    const second = session.handleNotification(message);
    assert.equal(usageCalls, 1);
    releaseUsage();
    await Promise.all([first, second]);
    assert.deepEqual((await session.next()).selection, { selected: [] });
    assert.equal(await session.next(), null);
    await session.close();
  });

  test("closed app-server stdin does not create an unhandled rejection while responding to a failed request", async () => {
    const child = new FakeChild();
    const client = new AppServerClient(child, {
      onServerRequest: async () => { throw new Error("simulated request handler failure"); },
    });
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      child.stdin.end();
      child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: "closed-stdin", method: "item/tool/call", params: {} })}\n`);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await client.close();
    }
  });

  test("concurrent runtime starts share the initialization and auth-isolation gate", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-concurrent-start-test-"));
    let configReadStarted;
    const configReadGate = new Promise((resolve) => { configReadStarted = resolve; });
    let releaseConfig;
    const configGate = new Promise((resolve) => { releaseConfig = resolve; });
    const fakeClient = {
      closed: false,
      async request(method) {
        if (method === "initialize") return { capabilities: { experimentalApi: true } };
        if (method === "config/read") {
          configReadStarted();
          await configGate;
          return { config: { additional: { cli_auth_credentials_store: "file" } } };
        }
        throw new Error(`unexpected request: ${method}`);
      },
      notify() {},
      async close() { this.closed = true; },
    };
    const runtime = new CodexAppServerRuntime({
      baseDir: path.join(root, "sessions"),
      codexHomePath: path.join(root, "codex-home"),
      configCwd: root,
      source: {},
      resolveRuntime: async () => ({ executablePath: "fake-codex", packageName: "fake", target: "fake", version: "0.147.0" }),
      spawnImpl: () => ({}),
      clientFactory: () => fakeClient,
      requestTimeoutMs: 2_000,
      sessionTimeoutMs: 2_000,
    });
    try {
      const first = runtime.start();
      await configReadGate;
      let secondSettled = false;
      const second = runtime.start().then(() => { secondSettled = true; });
      await Promise.resolve();
      assert.equal(secondSettled, false);
      assert.equal(runtime.client, null);
      releaseConfig();
      await Promise.all([first, second]);
      assert.strictEqual(runtime.client, fakeClient);
    } finally {
      await runtime.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("missing AO gateway reports the deterministic required-gateway error", () => {
    assert.throws(() => createCodexNativeAo(), { message: "CODEX_NATIVE_AO_GATEWAY_REQUIRED" });
  });

  test("Codex error categories keep future app-server failures out of generic errors", () => {
    assert.equal(classifyCodexError({ code: "CODEX_APP_SERVER_FUTURE_FAILURE" }), CODEX_ERROR_CATEGORIES.RUNTIME);
    assert.equal(classifyCodexError({ code: "CODEX_APP_SERVER_PROTOCOL_FUTURE" }), CODEX_ERROR_CATEGORIES.PROTOCOL);
    assert.equal(classifyCodexError({ code: "CODEX_AUTH_REQUIRED" }), CODEX_ERROR_CATEGORIES.AUTH);
    assert.equal(classifyCodexError({ code: "CODEX_LOGIN_TYPE_UNSUPPORTED" }), CODEX_ERROR_CATEGORIES.INPUT);
    assert.equal(classifyCodexError({ code: "SOME_UNRELATED_FAILURE" }), CODEX_ERROR_CATEGORIES.UNKNOWN);
  });

  test("dynamic legal tool schema is the four-tool product surface", () => {
    const tools = createLegalDynamicTools({ searchDisplay: 20, lawSearchDisplay: 5 });
    assert.deepEqual(tools.map((tool) => tool.name), [...LEGAL_TOOL_NAMES]);
    assert.equal(tools[0].inputSchema.properties.display.maximum, 20);
    assert.equal(tools[1].inputSchema.properties.display.maximum, 5);
    assert.equal(tools.some((tool) => tool.name === "legal_research"), false);
  });

  test("usage normalization accepts app-server camelCase snapshots without double counting", () => {
    assert.deepEqual(normalizeCodexTokenUsage({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      reasoningOutputTokens: 3,
      totalTokens: 17,
    }), {
      input_tokens: 10,
      cached_input_tokens: 2,
      output_tokens: 4,
      reasoning_tokens: 3,
      total_tokens: 17,
    });
  });

  test("ChatGPT account remains logged in when OpenAI auth is required", () => {
    const account = normalizeCodexAccount({
      account: { type: "chatgpt", email: "user@example.com", planType: "free" },
      requiresOpenaiAuth: true,
    });
    assert.equal(account.loggedIn, true);
    assert.equal(account.authMode, "chatgpt");
  });

  test("API key account remains logged in when OpenAI auth is required", () => {
    const account = normalizeCodexAccount({
      account: { type: "apiKey" },
      requiresOpenaiAuth: true,
    });
    assert.equal(account.loggedIn, true);
    assert.equal(account.authMode, "apiKey");
  });

  test("missing account requires login when OpenAI auth is required", () => {
    const account = normalizeCodexAccount({ account: null, requiresOpenaiAuth: true });
    assert.equal(account.loggedIn, false);
    assert.equal(account.authMode, "logged_out");
  });

  test("missing account reports authentication as not required", () => {
    const account = normalizeCodexAccount({ account: null, requiresOpenaiAuth: false });
    assert.equal(account.loggedIn, false);
    assert.equal(account.authMode, "not_required");
  });

  test("account manager exposes only safe account and rate-limit metadata", async () => {
    const listeners = new Set();
    const calls = [];
    const runtime = {
      onNotification(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async request(method, params) {
        calls.push({ method, params });
        if (method === "account/read") return { account: { email: "user@example.com", planType: "pro", type: "chatgpt", accessToken: "secret" }, requiresOpenaiAuth: true };
        if (method === "account/rateLimits/read") return { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 60, resetsAt: 123 } } };
        if (method === "account/login/start") return { type: params.type, loginId: "login-1", authUrl: "https://example.test/login" };
        return {};
      },
    };
    const manager = createCodexAccountManager({ runtime });
    const account = await manager.read();
    const limits = await manager.readRateLimits();
    const login = await manager.startLogin("chatgpt");
    assert.equal(account.email, "user@example.com");
    assert.equal(account.planType, "pro");
    assert.equal("accessToken" in account, false);
    assert.equal(limits.codexQuota.available, true);
    assert.equal(limits.codexQuota.windowDurationMins, 60);
    assert.equal(limits.codexQuota.windowKind, "other");
    assert.equal(limits.codexQuota.windowLabel, "1시간");
    assert.equal(login.loginId, "login-1");
    assert.equal(JSON.stringify(manager.snapshot()).includes("accessToken"), false);
    assert.deepEqual(normalizeCodexAccount({ account: { type: "chatgpt", email: null }, requiresOpenaiAuth: true }).loggedIn, true);
    assert.equal(normalizeCodexRateLimits({ rateLimits: { primary: { usedPercent: 1 } } }).limits.primary.usedPercent, 1);
    assert.equal(calls.some((item) => item.method === "account/read"), true);
    manager.close();
    assert.equal(listeners.size, 0);
  });

  test("account and rate-limit reads use a bounded cache until notification or expiry", async () => {
    const listeners = new Set();
    const calls = [];
    let now = 1_000;
    const runtime = {
      onNotification(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async request(method) {
        calls.push(method);
        if (method === "account/read") return { account: { planType: "pro", type: "chatgpt" }, requiresOpenaiAuth: true };
        if (method === "account/rateLimits/read") return { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080 } } };
        return {};
      },
    };
    const manager = createCodexAccountManager({ runtime, cacheTtlMs: 100, now: () => now });
    await manager.read();
    await manager.read();
    await manager.readRateLimits();
    assert.equal(calls.filter((method) => method === "account/read").length, 1);
    assert.equal(calls.filter((method) => method === "account/rateLimits/read").length, 1);

    now += 101;
    await manager.read();
    assert.equal(calls.filter((method) => method === "account/read").length, 2);
    assert.equal(calls.filter((method) => method === "account/rateLimits/read").length, 2);
    manager.close();
  });

  test("Codex quota normalization selects the preferred available window", () => {
    const reset = Date.parse("2026-08-28T06:20:00.000Z") / 1_000;
    const weekly = normalizeCodexQuota({
      rateLimits: {
        primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: reset },
        secondary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: reset },
      },
    });
    assert.deepEqual(weekly, {
      available: true,
      usedPercent: 37,
      remainingPercent: 63,
      windowDurationMins: 10080,
      windowKind: "weekly",
      windowLabel: "주간",
      resetsAt: reset,
      resetLabel: "2026년 8월 28일 오후 3:20",
    });

    const monthly = normalizeCodexQuota({
      rateLimits: {
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: reset },
        secondary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: reset },
      },
    });
    assert.deepEqual(monthly, {
      available: true,
      usedPercent: 2,
      remainingPercent: 98,
      windowDurationMins: 43200,
      windowKind: "monthly",
      windowLabel: "월간",
      resetsAt: reset,
      resetLabel: "2026년 8월 28일 오후 3:20",
    });

    const bothPreferred = normalizeCodexQuota({
      rateLimits: {
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: reset },
        secondary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: reset },
      },
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: reset } },
      },
    });
    assert.equal(bothPreferred.windowKind, "weekly");
    assert.equal(bothPreferred.usedPercent, 37);
    assert.equal(bothPreferred.windowLabel, "주간");

    const other = normalizeCodexQuota({
      rateLimits: {
        primary: { usedPercent: 20, windowDurationMins: 60 },
        secondary: { usedPercent: 80, windowDurationMins: 300 },
      },
    });
    assert.equal(other.windowKind, "other");
    assert.equal(other.windowDurationMins, 300);
    assert.equal(other.windowLabel, "5시간");
    assert.equal(other.usedPercent, 80);

    const freeFixture = normalizeCodexQuota({
      account: { planType: "free" },
      rateLimits: { primary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: 1789889511 } },
    });
    assert.deepEqual(freeFixture, {
      available: true,
      usedPercent: 2,
      remainingPercent: 98,
      windowDurationMins: 43200,
      windowKind: "monthly",
      windowLabel: "월간",
      resetsAt: 1789889511,
      resetLabel: "2026년 9월 20일 오후 4:31",
    });
    assert.deepEqual(normalizeCodexQuota({
      account: { planType: "pro" },
      rateLimits: { primary: { usedPercent: 2, windowDurationMins: 43200, resetsAt: 1789889511 } },
    }), freeFixture);

    const partial = normalizeCodexQuota({
      rateLimits: { primary: { usedPercent: 12, windowDurationMins: 43200, resetsAt: null } },
    });
    assert.deepEqual(partial, {
      available: true,
      usedPercent: 12,
      remainingPercent: 88,
      windowDurationMins: 43200,
      windowKind: "monthly",
      windowLabel: "월간",
      resetsAt: null,
      resetLabel: "",
    });

    const resetOnly = normalizeCodexQuota({
      rateLimits: { primary: { windowDurationMins: 43200, resetsAt: reset } },
    });
    assert.equal(resetOnly.available, true);
    assert.equal(resetOnly.usedPercent, null);
    assert.equal(resetOnly.windowLabel, "월간");
    assert.equal(resetOnly.resetLabel, "2026년 8월 28일 오후 3:20");

    assert.equal(normalizeCodexQuota({ rateLimits: { primary: { usedPercent: -5, windowDurationMins: 10080 } } }).usedPercent, 0);
    assert.equal(normalizeCodexQuota({ rateLimits: { primary: { usedPercent: 140, windowDurationMins: 10080 } } }).remainingPercent, 0);
    assert.equal(normalizeCodexQuota({ rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 } } }).windowLabel, "5시간");
    const onlyOther = normalizeCodexQuota({
      rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 } },
    });
    assert.equal(onlyOther.windowKind, "other");
    assert.equal(onlyOther.windowDurationMins, 300);
    assert.equal(onlyOther.windowLabel, "5시간");
    assert.deepEqual(normalizeCodexQuota({}), {
      available: false,
      usedPercent: null,
      remainingPercent: null,
      windowDurationMins: null,
      windowKind: "unknown",
      windowLabel: "",
      resetsAt: null,
      resetLabel: "",
    });
    assert.equal(formatCodexQuotaWindowLabel(60), "1시간");
    assert.equal(formatCodexQuotaWindowLabel(120), "2시간");
    assert.equal(formatCodexQuotaWindowLabel(1440), "1일");
    assert.equal(formatCodexQuotaWindowLabel(2880), "2일");
    assert.equal(formatCodexQuotaWindowLabel(61), "61분");
    assert.equal(selectCodexQuotaWindow([]), null);
    assert.match(formatCodexResetLabel(reset), /2026년 8월 28일 오후 3:20/u);
    assert.match(formatCodexResetLabel("2026-08-28T06:20:00.000Z"), /2026년 8월 28일 오후 3:20/u);
  });

  test("account notifications invalidate stale state and refresh account plus selected quota", async () => {
    const listeners = new Set();
    let loggedIn = false;
    let accountReads = 0;
    let rateReads = 0;
    const runtime = {
      onNotification(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async request(method) {
        if (method === "account/read") {
          accountReads += 1;
          return loggedIn
            ? { account: { email: "user@example.com", planType: "free", type: "chatgpt" }, requiresOpenaiAuth: true }
            : { account: {}, requiresOpenaiAuth: true };
        }
        if (method === "account/rateLimits/read") {
          rateReads += 1;
          return { rateLimits: { secondary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: 1787898000 } } };
        }
        return {};
      },
    };
    const manager = createCodexAccountManager({ runtime });
    assert.equal((await manager.read()).loggedIn, false);
    loggedIn = true;
    for (const listener of listeners) listener({ method: "account/login/completed", params: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snapshot = manager.snapshot();
    assert.equal(snapshot.account.loggedIn, true);
    assert.equal(snapshot.account.email, "user@example.com");
    assert.equal(snapshot.codexQuota.remainingPercent, 63);
    assert.ok(accountReads >= 2);
    assert.ok(rateReads >= 2);
    manager.close();
  });

  test("final parser accepts the frozen JSON response shape", () => {
    assert.deepEqual(parseFinalSelection("```json\n{\"selected\":[]}\n```"), { selected: [] });
  });
})();

// Consolidated from test/codexModelSelection.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const fs = (await import("node:fs/promises")).default;
  const test = (await import("node:test")).default;
  const { createAgenticSearchV2 } = await import("../../src/aoV2/index.js");
  const { normalizeModelResolution } = await import("../../src/codexAppServerRuntime.js");
  const { createLunaNativeAdapter } = await import("../../src/searchAdapters/lunaNativeAdapter.js");
  const { selectCodexModel } = await import("../../src/codexModelSelection.js");
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
      fs.readFile(new URL("../../src/codexAppServerRuntime.js", import.meta.url), "utf8"),
      fs.readFile(new URL("../../src/codexAppServerSession.js", import.meta.url), "utf8"),
    ]);
    for (const source of [runtime, session]) {
      assert.doesNotMatch(source, /planType|CodexAccountManager|selectCodexModel/iu);
    }
  });
})();
