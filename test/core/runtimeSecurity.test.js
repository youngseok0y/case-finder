// Consolidated from test/runtimeHygiene.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const { EventEmitter } = await import("node:events");
  const fs = await import("node:fs/promises");
  const http = (await import("node:http")).default;
  const os = await import("node:os");
  const { PassThrough, Writable } = await import("node:stream");
  const { spawnSync } = await import("node:child_process");
  const test = (await import("node:test")).default;
  const path = (await import("node:path")).default;
  const { fileURLToPath } = await import("node:url");
  const {
  APP_SERVER_BUFFER_LIMITS,
  createAppServerClient,
} = await import("../../src/codexAppServerClient.js");
  const { createAgenticSearchV2 } = await import("../../src/aoV2/index.js");
  const { createGeminiDAdapter } = await import("../../src/searchAdapters/geminiDAdapter.js");
  const { runDeterministicPipeline } = await import("../../src/nlPipeline.js");
  const { withMcpTimeout } = await import("../../src/mcpClient.js");
  const { sanitizeLogValue } = await import("../../src/log.js");
  const { waitForHealth } = await import("../../src/verifyManagedRuntime.js");
  const { createRequestHandler } = await import("../../src/server.js");
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

  class FakeChild extends EventEmitter {
    constructor() {
      super();
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.stdin = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      this.killed = false;
    }

    kill() {
      this.killed = true;
      this.emit("exit", 0, null);
    }
  }

  function tick() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  test("app-server diagnostic buffers stay bounded", async () => {
    const child = new FakeChild();
    const client = createAppServerClient(child);
    for (let index = 0; index < APP_SERVER_BUFFER_LIMITS.notifications + 20; index += 1) {
      child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notification", params: { index } })}\n`);
    }
    for (let index = 0; index < APP_SERVER_BUFFER_LIMITS.parseErrors + 20; index += 1) child.stdout.write(`not-json-${index}\n`);
    child.stderr.write("x".repeat(APP_SERVER_BUFFER_LIMITS.stderrBytes * 2));
    await tick();
    assert.equal(client.notifications.length, APP_SERVER_BUFFER_LIMITS.notifications);
    assert.equal(client.parseErrors.length, APP_SERVER_BUFFER_LIMITS.parseErrors);
    assert.ok(Buffer.byteLength(client.stderr.join(""), "utf8") <= APP_SERVER_BUFFER_LIMITS.stderrBytes);
    await client.close();
  });

  test("abort signal closes an active AO session and rejects as ABORTED", async () => {
    const controller = new AbortController();
    let release;
    let closeCount = 0;
    const search = createAgenticSearchV2({
      provider: "codex_luna",
      adapterOptions: {
        createSession: async () => ({
          next: () => new Promise((resolve) => { release = resolve; }),
          async close() {
            closeCount += 1;
            release?.(null);
          },
        }),
      },
    });
    const pending = search.runWithContext("abort fixture", { abortSignal: controller.signal });
    await tick();
    controller.abort();
    await assert.rejects(pending, (error) => error.code === "ABORTED");
    assert.equal(closeCount, 1);
  });

  test("HTTP client disconnect aborts the active query signal", async () => {
    let queryStarted;
    let queryStartedResolve;
    let abortedResolve;
    queryStarted = new Promise((resolve) => { queryStartedResolve = resolve; });
    const aborted = new Promise((resolve) => { abortedResolve = resolve; });
    const server = http.createServer(createRequestHandler({
      executeQueryImpl: async (_query, _onProgress, { abortSignal }) => {
        queryStartedResolve();
        await new Promise((_, reject) => {
          abortSignal.addEventListener("abort", () => {
            abortedResolve();
            const error = new Error("ABORTED");
            error.code = "ABORTED";
            reject(error);
          }, { once: true });
        });
      },
    }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/ask",
      method: "POST",
      headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, "content-type": "application/json" },
    });
    request.on("error", () => {});
    request.end(JSON.stringify({ query: "disconnect fixture" }));
    try {
      await queryStarted;
      request.destroy();
      await Promise.race([
        aborted,
        new Promise((_, reject) => setTimeout(() => reject(new Error("HTTP abort signal timeout")), 1_000)),
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("MCP timeout wrapper observes abort signals", async () => {
    const controller = new AbortController();
    const pending = withMcpTimeout(new Promise(() => {}), 1_000, controller.signal);
    controller.abort();
    await assert.rejects(pending, (error) => error.code === "ABORTED");
  });

  test("Gemini adapter abort stops the pipeline before later MCP work", async () => {
    const controller = new AbortController();
    let collectCalls = 0;
    const adapter = createGeminiDAdapter({
      run: (query, dependencies) => runDeterministicPipeline(query, {
        ...dependencies,
        generatePlan: async () => {
          dependencies.onProgress("ANALYSIS_COMPLETE");
          return {
            queries: [
              { query: "anchor one", domain: "precedent", kind: "anchor" },
              { query: "anchor two", domain: "precedent", kind: "anchor" },
              { query: "support one", domain: "precedent", kind: "support" },
              { query: "support two", domain: "precedent", kind: "support" },
            ],
            law_names: [],
          };
        },
        collectCandidates: async () => {
          collectCalls += 1;
          return [];
        },
        searchRelatedLaws: async () => [],
        lookupQueryLawReferences: async () => [],
        prepareCandidates: async () => ({ candidatesWithPreview: [] }),
        selectCandidates: async () => ({ support: "none", selected: [], intro: "" }),
      }),
    });

    await assert.rejects(
      adapter.runNaturalQuery("abort fixture", {
        abortSignal: controller.signal,
        onProgress: (event) => {
          if (event === "ANALYSIS_COMPLETE") controller.abort();
        },
      }),
      (error) => error.code === "ABORTED",
    );
    assert.equal(collectCalls, 0);
  });

  test("error and validation log values redact credentials and tokens", () => {
    const value = sanitizeLogValue("LAW_OC=law-secret GEMINI_API_KEY=gemini-secret AUTH_TOKEN=auth-token Authorization: auth-secret Bearer bearer-secret");
    assert.doesNotMatch(value, /law-secret|gemini-secret|auth-token|auth-secret|bearer-secret/iu);
    assert.match(value, /REDACTED/iu);
  });

  test("packaging prune refuses an omitted staging root", () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "packaging", "prune-staging.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /missing required --stage/iu);
  });

  test("managed health retries a 200 response with invalid JSON", async () => {
    let requestCount = 0;
    const health = await waitForHealth(3311, { exitCode: null }, {
      fetchImpl: async () => {
        requestCount += 1;
        return {
          status: 200,
          json: async () => {
            if (requestCount === 1) throw new SyntaxError("invalid health JSON");
            return { service: "case-finder", ok: true };
          },
        };
      },
      sleep: async () => {},
    });
    assert.deepEqual(health, { service: "case-finder", ok: true });
    assert.equal(requestCount, 2);
  });

  test("packaging prune has only non-empty levels and fails closed for missing targets", async () => {
    const source = await fs.readFile(path.join(ROOT, "packaging", "prune-staging.mjs"), "utf8");
    assert.doesNotMatch(source, /\b\d+\s*:\s*\[\s*\]/u);

    const stageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-prune-"));
    try {
      const missing = spawnSync(process.execPath, [
        path.join(ROOT, "packaging", "prune-staging.mjs"),
        "--stage",
        stageRoot,
        "--level",
        "1",
      ], { cwd: ROOT, encoding: "utf8" });
      assert.notEqual(missing.status, 0);
      assert.match(`${missing.stdout}\n${missing.stderr}`, /expected prune target is missing/iu);

      for (const relativePath of [
        "node_modules/sharp",
        "node_modules/@img/colour",
        "node_modules/@img/sharp-win32-x64",
      ]) {
        await fs.mkdir(path.join(stageRoot, relativePath), { recursive: true });
      }
      const pruned = spawnSync(process.execPath, [
        path.join(ROOT, "packaging", "prune-staging.mjs"),
        "--stage",
        stageRoot,
        "--level",
        "4",
      ], { cwd: ROOT, encoding: "utf8" });
      assert.equal(pruned.status, 0, `${pruned.stdout}\n${pruned.stderr}`);
      assert.match(pruned.stdout, /"level": 4/iu);
    } finally {
      await fs.rm(stageRoot, { recursive: true, force: true });
    }
  });
})();

// Consolidated from test/runtimeSecurity.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { buildMcpServerParameters, MCP_CALL_TIMEOUT, runMcpCall, withMcpTimeout } = await import("../../src/mcpClient.js");
  const { isTrustedLocalHost, sameOrigin } = await import("../../src/server.js");
  const { buildLegalMcpEnv } = await import("../../src/runtimeEnv.js");
  function request(headers, localPort = 3300) {
    return { headers, socket: { localPort } };
  }

  test("HTTP trust boundary accepts only the local host and same origin", () => {
    assert.equal(isTrustedLocalHost(request({ host: "127.0.0.1:3300" })), true);
    assert.equal(sameOrigin(request({ host: "localhost:3300", origin: "http://127.0.0.1:3300" })), true);
    assert.equal(isTrustedLocalHost(request({ host: "evil.example:3300" })), false);
    assert.equal(sameOrigin(request({ host: "127.0.0.1:3300", origin: "https://127.0.0.1:3300" })), false);
  });

  test("MCP timeout and transport retry are bounded", async () => {
    await assert.rejects(
      withMcpTimeout(new Promise((resolve) => setTimeout(resolve, 25)), 5),
      (error) => error.code === MCP_CALL_TIMEOUT,
    );

    let calls = 0;
    let closes = 0;
    let reconnects = 0;
    const result = await runMcpCall({
      timeoutMs: 100,
      call: async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("transport disconnected");
          error.code = "MCP_TRANSPORT_DISCONNECTED";
          throw error;
        }
        return "ok";
      },
      closeTransport: async () => { closes += 1; },
      reconnect: async () => { reconnects += 1; },
    });
    assert.equal(result, "ok");
    assert.equal(calls, 2);
    assert.equal(closes, 1);
    assert.equal(reconnects, 1);
  });

  test("managed MCP uses the packaged private Node executable", () => {
    const rootDir = "C:\\Case Finder\\app";
    const managedNodePath = "C:\\Case Finder\\runtime\\node\\node.exe";
    const upstreamEntry = `${rootDir}\\node_modules\\korean-law-mcp\\build\\index.js`;
    const result = buildMcpServerParameters({
      platform: "win32",
      source: { ComSpec: "C:\\Windows\\System32\\cmd.exe", PATH: "C:\\Windows\\System32" },
      rootDir,
      runtimePaths: { managedNodePath },
      lawOc: "test-law",
      fsImpl: { existsSync(value) { return value === managedNodePath || value === upstreamEntry; } },
    });
    assert.equal(result.mode, "managed-node");
    assert.equal(result.command, managedNodePath);
    assert.deepEqual(result.args, [upstreamEntry]);
    assert.equal(result.env.LAW_OC, "test-law");
  });

  test("MCP child environment keeps legal credentials and strips provider secrets", () => {
    const rootDir = "C:\\Case Finder\\app";
    const binPath = `${rootDir}\\node_modules\\.bin\\korean-law-mcp`;
    const result = buildMcpServerParameters({
      platform: "linux",
      source: {
        PATH: "/usr/bin",
        SYSTEMROOT: "/system",
        LAW_OC: "law-from-source",
        GEMINI_API_KEY: "gemini-secret",
        TEST_SECRET: "test-secret",
      },
      rootDir,
      lawOc: "law-from-source",
      fsImpl: { existsSync(value) { return value === binPath; } },
    });
    assert.equal(result.env.LAW_OC, "law-from-source");
    assert.equal(result.env.PATH, "/usr/bin");
    assert.equal(result.env.SYSTEMROOT, "/system");
    assert.equal("GEMINI_API_KEY" in result.env, false);
    assert.equal("TEST_SECRET" in result.env, false);
  });

  test("Case Finder child environments do not inherit ambient CODEX_HOME", () => {
    const env = buildLegalMcpEnv({
      CODEX_HOME: "C:\\Users\\Test\\.codex",
      LAW_OC: "law-from-source",
    }, "law-from-source");
    assert.equal("CODEX_HOME" in env, false);
  });
})();
