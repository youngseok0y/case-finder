import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildCodexChildEnv } from "../src/codexNativeSession.js";
import { resolveCodexCommand } from "../src/codexResolver.js";
import { closeStaleTransport } from "../src/mcpClient.js";
import { buildLegalMcpEnv } from "../src/runtimeEnv.js";
import { resolveRuntimePaths } from "../src/runtimePaths.js";

function fakeCodexFs(existing) {
  return {
    existsSync(value) { return existing.has(value); },
  };
}

function candidateFixture(root, paths = resolveRuntimePaths({
  source: { CASE_FINDER_INSTALL_ROOT: root },
  appRoot: `${root}\\app`,
})) {
  return {
    paths,
    managedHost: paths.managedCodexHostPath,
    managedCli: paths.managedCodexPath,
    overrideCli: `${root}\\developer\\codex.exe`,
    overrideHost: `${root}\\developer\\codex-code-mode-host.exe`,
    pathCli: `${root}\\path\\codex.exe`,
    pathHost: `${root}\\path\\codex-code-mode-host.exe`,
  };
}

test("Codex child environment excludes Case Finder secrets and pins managed CODEX_HOME", () => {
  const env = buildCodexChildEnv({
    PATH: "C:\\node",
    USERPROFILE: "C:\\Users\\test",
    LAW_OC: "law-secret",
    GEMINI_API_KEY: "gemini-secret",
    GOOGLE_APPLICATION_CREDENTIALS: "credentials.json",
    CODEX_HOME: "C:\\Users\\test\\.codex",
  }, {
    legalMcpLogPath: "C:\\tmp\\proxy.log",
    codexHomePath: "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\state\\codex-home",
  });
  assert.equal(env.PATH, "C:\\node");
  assert.equal(env.CODEX_HOME, "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\state\\codex-home");
  assert.equal(env.LEGAL_MCP_LOG_PATH, "C:\\tmp\\proxy.log");
  assert.equal(env.LAW_OC, undefined);
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
});

test("managed Codex candidate has priority over developer override and PATH", () => {
  const fixture = candidateFixture("C:\\Managed");
  const existing = new Set([
    fixture.managedCli,
    fixture.managedHost,
    fixture.overrideCli,
    fixture.overrideHost,
    fixture.pathCli,
    fixture.pathHost,
  ]);
  const result = resolveCodexCommand({
    configured: fixture.overrideCli,
    source: {},
    platform: "win32",
    fsImpl: fakeCodexFs(existing),
    runtimePaths: fixture.paths,
    execFile(command, args) {
      if (command === "where.exe") return "";
      assert.equal(command, fixture.managedCli);
      assert.deepEqual(args, ["--version"]);
      return "codex-cli managed";
    },
  });
  assert.equal(result.source, "managed");
  assert.equal(result.version, "codex-cli managed");
});

test("developer CODEX_CLI_PATH is used when managed Codex is unavailable", () => {
  const fixture = candidateFixture("C:\\Override");
  const existing = new Set([fixture.overrideCli, fixture.overrideHost]);
  const result = resolveCodexCommand({
    configured: fixture.overrideCli,
    source: {},
    platform: "win32",
    fsImpl: fakeCodexFs(existing),
    runtimePaths: fixture.paths,
    execFile(command) {
      if (command === "where.exe") return "";
      assert.equal(command, fixture.overrideCli);
      return "codex-cli override";
    },
  });
  assert.equal(result.source, "override");
});

test("PATH Codex is used after managed and explicit override candidates", () => {
  const fixture = candidateFixture("C:\\Path");
  const existing = new Set([fixture.pathCli, fixture.pathHost]);
  const result = resolveCodexCommand({
    configured: fixture.overrideCli,
    source: {},
    platform: "win32",
    fsImpl: fakeCodexFs(existing),
    runtimePaths: fixture.paths,
    execFile(command, args) {
      if (command === "where.exe") return `${fixture.pathCli}\r\n`;
      assert.equal(command, fixture.pathCli);
      assert.deepEqual(args, ["--version"]);
      return "codex-cli path";
    },
  });
  assert.equal(result.source, "path");
});

test("resolver rejects a candidate without code-mode host", () => {
  const fixture = candidateFixture("C:\\NoHost");
  const existing = new Set([fixture.overrideCli]);
  assert.throws(() => resolveCodexCommand({
    configured: fixture.overrideCli,
    source: {},
    platform: "win32",
    fsImpl: fakeCodexFs(existing),
    runtimePaths: fixture.paths,
    execFile: (command) => {
      if (command === "where.exe") throw new Error("where unavailable");
      return "codex-cli test";
    },
  }), { code: "CODEX_HOST_UNAVAILABLE" });
});

test("resolver rejects a candidate whose version check fails", () => {
  const fixture = candidateFixture("C:\\VersionFail");
  const existing = new Set([fixture.overrideCli, fixture.overrideHost]);
  assert.throws(() => resolveCodexCommand({
    configured: fixture.overrideCli,
    source: {},
    platform: "win32",
    fsImpl: fakeCodexFs(existing),
    runtimePaths: fixture.paths,
    execFile: () => { throw new Error("version failed"); },
  }), { code: "CODEX_VERSION_CHECK_FAILED" });
});

test("resolver reports CODEX_CLI_UNAVAILABLE when all candidates fail", () => {
  const fixture = candidateFixture("C:\\Unavailable");
  assert.throws(() => resolveCodexCommand({
    configured: fixture.overrideCli,
    source: {},
    platform: "win32",
    fsImpl: fakeCodexFs(new Set()),
    runtimePaths: fixture.paths,
    execFile: () => { throw new Error("where failed"); },
  }), { code: "CODEX_CLI_UNAVAILABLE" });
});

test("runtime paths are independent from the current working directory", () => {
  const paths = resolveRuntimePaths({
    source: {
      CASE_FINDER_INSTALL_ROOT: "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder",
      CASE_FINDER_APP_ROOT: "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\app",
    },
    appRoot: "C:\\repo",
  });
  assert.equal(paths.managedNodePath, "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\runtime\\node\\node.exe");
  assert.equal(paths.managedCodexPath, "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\runtime\\codex\\bin\\codex.exe");
  assert.equal(paths.codexHomePath, "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\state\\codex-home");
  assert.equal(paths.logsPath, "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\logs");
  assert.equal(paths.serverPath, "C:\\Users\\test\\AppData\\Local\\Fable\\CaseFinder\\app\\src\\server.js");
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

test("launcher uses the private Node runtime and preserves foreign port safety", () => {
  const launcher = fs.readFileSync(new URL("../start.bat", import.meta.url), "utf8");
  assert.match(launcher, /runtime\\node\\node\.exe/u);
  assert.match(launcher, /runtime\\codex/u);
  assert.match(launcher, /checkCaseFinderHealth/u);
  assert.match(launcher, /tasklist/u);
  assert.match(launcher, /Refusing to terminate an unconfirmed process/u);
  assert.match(launcher, /Case Finder \/health did not respond/u);
  assert.match(launcher, /logs\/error\.log/u);
  assert.match(launcher, /MANAGED_RUNTIME/u);
  assert.match(launcher, /npm ci/u);
  assert.match(launcher, /echo Node\.js \^>=24\.14\.0 and \^<25 is required\./u);
});

test("health exposes Luna readiness without running an LLM query", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /getCodexRuntimeStatus/u);
  assert.match(server, /luna,/u);
  assert.match(server, /LUNA_INSTALL_REQUIRED_MESSAGE/u);
  assert.match(server, /CODEX_HOST_UNAVAILABLE/u);
});

test("direct response envelope includes the product service marker", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /ok: true,\s*service: PRODUCT_SERVICE,\s*stage: "DIRECT"/u);
});
