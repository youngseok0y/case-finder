import assert from "node:assert/strict";
import test from "node:test";
import { buildMcpServerParameters, MCP_CALL_TIMEOUT, runMcpCall, withMcpTimeout } from "../src/mcpClient.js";
import { isTrustedLocalHost, sameOrigin } from "../src/server.js";
import { buildLegalMcpEnv } from "../src/runtimeEnv.js";

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
