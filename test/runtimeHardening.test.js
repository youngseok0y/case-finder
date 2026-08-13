import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildCodexChildEnv } from "../src/codexNativeSession.js";
import { resolveCodexCommand } from "../src/codexResolver.js";
import { closeStaleTransport } from "../src/mcpClient.js";
import { buildLegalMcpEnv } from "../src/runtimeEnv.js";

test("Codex child environment excludes Case Finder secrets", () => {
  const env = buildCodexChildEnv({
    PATH: "C:\\node",
    USERPROFILE: "C:\\Users\\test",
    LAW_OC: "law-secret",
    GEMINI_API_KEY: "gemini-secret",
    GOOGLE_APPLICATION_CREDENTIALS: "credentials.json",
    CODEX_HOME: "C:\\Users\\test\\.codex",
  }, { legalMcpLogPath: "C:\\tmp\\proxy.log" });
  assert.equal(env.PATH, "C:\\node");
  assert.equal(env.CODEX_HOME, "C:\\Users\\test\\.codex");
  assert.equal(env.LEGAL_MCP_LOG_PATH, "C:\\tmp\\proxy.log");
  assert.equal(env.LAW_OC, undefined);
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
});

test("Codex resolver finds a user plugin CLI without an absolute configuration", () => {
  const userProfile = "C:\\Users\\test";
  const pluginCli = `${userProfile}\\.codex\\plugins\\.plugin-appserver\\codex.exe`;
  const pluginHost = `${userProfile}\\.codex\\plugins\\.plugin-appserver\\codex-code-mode-host.exe`;
  const existing = new Set([pluginCli, pluginHost]);
  const fakeFs = {
    existsSync(value) { return existing.has(value); },
    readdirSync(value) {
      assert.equal(value, `${userProfile}\\.codex\\plugins`);
      return [{ name: ".plugin-appserver", isDirectory: () => true }];
    },
  };
  const result = resolveCodexCommand({
    configured: "codex",
    source: { USERPROFILE: userProfile },
    platform: "win32",
    fsImpl: fakeFs,
    execFile(command, args) {
      assert.equal(command, pluginCli);
      assert.deepEqual(args, ["--version"]);
      return "codex-cli test";
    },
  });
  assert.equal(result.command, pluginCli);
  assert.deepEqual(result.prefixArgs, []);
});

test("Codex resolver rejects a CLI that has no code-mode host", () => {
  assert.throws(() => resolveCodexCommand({
    configured: "C:\\Users\\test\\.codex\\.sandbox-bin\\codex.exe",
    source: { USERPROFILE: "C:\\Users\\test" },
    platform: "win32",
    fsImpl: {
      existsSync: (value) => value === "C:\\Users\\test\\.codex\\.sandbox-bin\\codex.exe",
      readdirSync: () => [],
    },
    execFile: () => "codex-cli test",
  }), { code: "CODEX_CLI_UNAVAILABLE" });
});

test("restricted legal MCP upstream environment forwards only LAW_OC", () => {
  const env = buildLegalMcpEnv({
    PATH: "C:\\node",
    LAW_OC: "source-law-secret",
    GEMINI_API_KEY: "gemini-secret",
    GOOGLE_APPLICATION_CREDENTIALS: "credentials.json",
    CASE_FINDER_SKIP_DOTENV: "1",
  }, "law-secret");
  assert.equal(env.PATH, "C:\\node");
  assert.equal(env.LAW_OC, "law-secret");
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(env.CASE_FINDER_SKIP_DOTENV, undefined);
});

test("MCP stale transport cleanup closes the old handle", async () => {
  let closeCalls = 0;
  await closeStaleTransport({
    async close() { closeCalls += 1; },
  });
  assert.equal(closeCalls, 1);
});

test("launcher refuses foreign port ownership and points to the real error log", () => {
  const launcher = fs.readFileSync(new URL("../start.bat", import.meta.url), "utf8");
  assert.match(launcher, /checkCaseFinderHealth/u);
  assert.match(launcher, /tasklist/u);
  assert.match(launcher, /Refusing to terminate an unconfirmed process/u);
  assert.match(launcher, /Case Finder \/health did not respond/u);
  assert.match(launcher, /logs\/error\.log/u);
  assert.doesNotMatch(launcher, /Stopping existing process\.\.\.[\s\S]*taskkill/u);
  assert.match(launcher, /echo Node\.js \^>=24\.14\.0 and \^<25 is required\./u);
});

test("direct response envelope includes the product service marker", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /ok: true,\s*service: PRODUCT_SERVICE,\s*stage: "DIRECT"/u);
  assert.match(server, /CODEX_CLI_UNAVAILABLE/u);
  assert.match(server, /LUNA_RUNTIME_UNAVAILABLE_MESSAGE/u);
});
