// Consolidated from test/codexAuthIsolation.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const { EventEmitter } = await import("node:events");
  const fs = (await import("node:fs/promises")).default;
  const { PassThrough, Writable } = await import("node:stream");
  const os = (await import("node:os")).default;
  const path = (await import("node:path")).default;
  const test = (await import("node:test")).default;
  const { buildCodexChildEnv } = await import("../../src/codexEnv.js");
  const {
  assertFileCredentialStore,
  CODEX_AUTH_HOME_UNAVAILABLE,
  CODEX_AUTH_ISOLATION_UNSAFE,
  effectiveCodexCredentialStore,
  prepareCodexHome,
} = await import("../../src/codexAuthIsolation.js");
  const { CodexAppServerRuntime } = await import("../../src/codexAppServerRuntime.js");
  const { buildCodexAppServerEnv } = await import("../../src/codexRuntimeResolver.js");
  class AuthFakeChild extends EventEmitter {
    constructor(store = "file") {
      super();
      this.store = store;
      this.stdout = new PassThrough();
      this.stderr = new PassThrough();
      this.killed = false;
      this.stdin = new Writable({
        write: (chunk, encoding, callback) => {
          const message = JSON.parse(String(chunk, encoding));
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
        this.#send({ jsonrpc: "2.0", id: message.id, result: {} });
        return;
      }
      if (message.method === "config/read") {
        this.#send({
          jsonrpc: "2.0",
          id: message.id,
          result: { config: { additional: { cli_auth_credentials_store: this.store } } },
        });
        return;
      }
      if (message.method === "account/read") {
        this.#send({
          jsonrpc: "2.0",
          id: message.id,
          result: { account: {}, requiresOpenaiAuth: true },
        });
        return;
      }
      if (message.method === "account/rateLimits/read") {
        this.#send({ jsonrpc: "2.0", id: message.id, result: { rateLimits: {} } });
        return;
      }
      if (message.method === "account/login/start") {
        this.#send({
          jsonrpc: "2.0",
          id: message.id,
          result: { type: message.params.type, loginId: "login-1", authUrl: "https://example.test/login" },
        });
        return;
      }
      this.#send({ jsonrpc: "2.0", id: message.id, result: {} });
    }

    kill() {
      this.killed = true;
      this.emit("exit", 0, null);
    }
  }

  async function makeRoots() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-codex-isolation-"));
    const userRoot = path.join(root, "user");
    const dedicated = path.join(root, "case-finder", "state", "codex-home");
    await fs.mkdir(path.join(userRoot, ".codex"), { recursive: true });
    return { root, userRoot, dedicated, source: { USERPROFILE: userRoot, HOME: userRoot, CODEX_HOME: path.join(userRoot, ".codex") } };
  }

  test("Codex child env ignores ambient CODEX_HOME and requires an explicit dedicated home", () => {
    const dedicated = "C:\\CaseFinder\\state\\codex-home";
    const source = { HOME: "C:\\Users\\Test", CODEX_HOME: "C:\\Users\\Test\\.codex" };
    const childEnv = buildCodexChildEnv(source, { codexHomePath: dedicated });
    assert.equal(childEnv.CODEX_HOME, dedicated);
    assert.equal(buildCodexChildEnv(source).CODEX_HOME, undefined);
    assert.equal("CODEX_HOME" in buildCodexChildEnv(source), false);
  });

  test("dedicated config.toml is idempotently forced to file while preserving other settings", async () => {
    const { root, userRoot, dedicated } = await makeRoots();
    try {
      await fs.mkdir(dedicated, { recursive: true });
      const configPath = path.join(dedicated, "config.toml");
      await fs.writeFile(configPath, 'model = "gpt-test"\ncli_auth_credentials_store = "auto"\n[notice]\nenabled = true\n', "utf8");
      await prepareCodexHome(dedicated, { source: { USERPROFILE: userRoot, HOME: userRoot } });
      const config = await fs.readFile(configPath, "utf8");
      assert.match(config, /^model = "gpt-test"$/mu);
      assert.match(config, /^cli_auth_credentials_store = "file"$/mu);
      assert.match(config, /^\[notice\]$/mu);
      assert.equal((config.match(/cli_auth_credentials_store/gu) || []).length, 1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("global auth sentinel remains unchanged across dedicated app-server account flows", async () => {
    const { root, userRoot, dedicated, source } = await makeRoots();
    const globalAuth = path.join(userRoot, ".codex", "auth.json");
    const sentinel = "GLOBAL_AUTH_SENTINEL";
    await fs.writeFile(globalAuth, sentinel, "utf8");
    const before = await fs.stat(globalAuth);
    const child = new AuthFakeChild();
    const runtime = new CodexAppServerRuntime({
      baseDir: path.join(root, "runtime"),
      codexHomePath: dedicated,
      configCwd: root,
      source,
      resolveRuntime: async () => ({ executablePath: "fake-codex", packageName: "fake", target: "fake", version: "0.147.0" }),
      spawnImpl: () => child,
      requestTimeoutMs: 2_000,
      sessionTimeoutMs: 2_000,
    });

    try {
      await runtime.start();
      const { createCodexAccountManager } = await import("../../src/codexAccount.js");
      const manager = createCodexAccountManager({ runtime });
      await manager.read();
      await manager.startLogin("chatgpt");
      await manager.cancelLogin();
      await manager.startLogin("chatgptDeviceCode");
      await manager.logout();
      manager.close();
      const after = await fs.stat(globalAuth);
      assert.equal(await fs.readFile(globalAuth, "utf8"), sentinel);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.match(await fs.readFile(path.join(dedicated, "config.toml"), "utf8"), /cli_auth_credentials_store\s*=\s*"file"/u);
    } finally {
      await runtime.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("unsafe global home and dedicated-home write failures fail closed without fallback", async () => {
    const { root, userRoot, dedicated, source } = await makeRoots();
    const globalHome = path.join(userRoot, ".codex");
    try {
      await assert.rejects(
        buildCodexAppServerEnv(source, { codexHomePath: globalHome }),
        (error) => error.code === CODEX_AUTH_ISOLATION_UNSAFE,
      );

      const failingFs = {
        ...fs,
        async writeFile() {
          const error = new Error("permission denied");
          error.code = "EACCES";
          throw error;
        },
      };
      await assert.rejects(
        prepareCodexHome(dedicated, { source, fsImpl: failingFs }),
        (error) => error.code === CODEX_AUTH_HOME_UNAVAILABLE,
      );
      assert.equal(await fs.readFile(path.join(globalHome, "auth.json"), "utf8").catch(() => null), null);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test("effective credential store must be file and app-server refuses non-file config", async () => {
    assert.equal(effectiveCodexCredentialStore({ config: { additional: { cli_auth_credentials_store: "file" } } }), "file");
    assert.equal(effectiveCodexCredentialStore({ config: { additional: { cli_auth_credentials_store: "auto" } } }), "auto");
    assert.throws(() => assertFileCredentialStore({ config: { additional: { cli_auth_credentials_store: "keyring" } } }), (error) => error.code === CODEX_AUTH_ISOLATION_UNSAFE);

    const { root, dedicated, source } = await makeRoots();
    const child = new AuthFakeChild("auto");
    const runtime = new CodexAppServerRuntime({
      baseDir: path.join(root, "runtime"),
      codexHomePath: dedicated,
      configCwd: root,
      source,
      resolveRuntime: async () => ({ executablePath: "fake-codex", packageName: "fake", target: "fake", version: "0.147.0" }),
      spawnImpl: () => child,
      requestTimeoutMs: 2_000,
    });
    try {
      await assert.rejects(runtime.start(), (error) => error.code === CODEX_AUTH_ISOLATION_UNSAFE);
      assert.equal(child.killed, true);
    } finally {
      await runtime.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
})();
