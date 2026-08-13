import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildCodexChildEnv } from "../src/codexNativeSession.js";
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
});
