import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { isCodexAuthFailure } from "../src/codexAuth.js";
import { withMcpTimeout, runMcpCall, MCP_CALL_TIMEOUT } from "../src/mcpClient.js";
import { inspectPackagedCodexRuntime } from "../src/lunaSdkRuntime.js";
import { createRestrictedToolHandler } from "../src/aoV2/restrictedMcp/requestHandler.js";
import { LEGAL_TOOL_NAMES } from "../src/aoV2/legalToolGateway.js";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { createSafetyController } from "../src/aoV2/safety.js";
import { createTelemetry } from "../src/aoV2/telemetry.js";
import { createSearchAdapterRegistry, SearchAdapterUnsupportedError } from "../src/searchAdapters/registry.js";
import { createRequestHandler } from "../src/server.js";
import { validateAdminPatch } from "../src/adminConfig.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("packaged Codex preflight decodes ASCII, space, and Korean file URLs", async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-h1-"));
  class ProbeCodex {
    startThread() {
      return { runStreamed() {} };
    }
  }
  try {
    for (const label of ["ascii", "space path", "한글 경로"]) {
      const packageRoot = path.join(testRoot, label, "node_modules", "@openai", "codex-win32-x64");
      const packageJsonPath = path.join(packageRoot, "package.json");
      const vendorRoot = path.join(packageRoot, "vendor", "x86_64-pc-windows-msvc", "bin");
      await fs.mkdir(vendorRoot, { recursive: true });
      await fs.writeFile(packageJsonPath, "{}", "utf8");
      await fs.writeFile(path.join(vendorRoot, "codex.exe"), "", "utf8");
      await fs.writeFile(path.join(vendorRoot, "codex-code-mode-host.exe"), "", "utf8");

      const runtime = await inspectPackagedCodexRuntime({
        platform: "win32",
        arch: "x64",
        CodexClass: ProbeCodex,
        source: { USERPROFILE: "C:\\Users\\tester" },
        resolvePackage: async () => pathToFileURL(packageJsonPath).href,
      });
      assert.equal(runtime.executable, true);
      assert.equal(runtime.host, true);
    }
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

test("Codex auth classification keeps token-limit failures non-auth failures", () => {
  const positive = [
    "authentication required",
    "authentication failed",
    "unauthorized",
    "unauthorised",
    "not logged in",
    "login required",
    "sign-in required",
    "invalid access token",
    "expired access token",
    "refresh token expired",
    "token revoked",
  ];
  const negative = [
    "maximum tokens exceeded",
    "max tokens exceeded",
    "token count exceeded",
    "output token limit exceeded",
    "context token limit",
  ];
  for (const message of positive) assert.equal(isCodexAuthFailure(message), true, message);
  assert.equal(isCodexAuthFailure({ error: { message: "authentication required" } }), true);
  for (const message of negative) assert.equal(isCodexAuthFailure(message), false, message);
});

test("MCP timeout rejects with a stable code and clears its timer", async () => {
  assert.equal(await withMcpTimeout(Promise.resolve("ok"), 100), "ok");
  await assert.rejects(
    withMcpTimeout(new Promise(() => {}), 5),
    (error) => error.code === MCP_CALL_TIMEOUT,
  );
  await assert.rejects(
    withMcpTimeout(Promise.reject(new Error("fast failure")), 100),
    /fast failure/u,
  );
});

test("MCP timeout does not close a shared transport or affect a concurrent fast call", async () => {
  let closeCalls = 0;
  let reconnectCalls = 0;
  let slowCalls = 0;
  const slow = runMcpCall({
    timeoutMs: 10,
    call: async () => {
      slowCalls += 1;
      await delay(50);
      return "slow";
    },
    closeTransport: async () => { closeCalls += 1; },
    reconnect: async () => { reconnectCalls += 1; },
  });
  const fast = runMcpCall({
    timeoutMs: 100,
    call: async () => "fast",
    closeTransport: async () => { closeCalls += 1; },
    reconnect: async () => { reconnectCalls += 1; },
  });
  const [slowResult, fastResult] = await Promise.allSettled([slow, fast]);
  assert.equal(slowResult.status, "rejected");
  assert.equal(slowResult.reason.code, MCP_CALL_TIMEOUT);
  assert.deepEqual(fastResult, { status: "fulfilled", value: "fast" });
  assert.equal(slowCalls, 1);
  assert.equal(closeCalls, 0);
  assert.equal(reconnectCalls, 0);
});

test("MCP transport failure reconnects and retries once, with a bounded retry", async () => {
  let attempts = 0;
  let closeCalls = 0;
  let reconnectCalls = 0;
  const value = await runMcpCall({
    timeoutMs: 100,
    call: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("transport closed");
        error.code = "MCP_TRANSPORT_CLOSED";
        throw error;
      }
      return "recovered";
    },
    closeTransport: async () => { closeCalls += 1; },
    reconnect: async () => { reconnectCalls += 1; },
  });
  assert.equal(value, "recovered");
  assert.equal(attempts, 2);
  assert.equal(closeCalls, 1);
  assert.equal(reconnectCalls, 1);

  attempts = 0;
  await assert.rejects(runMcpCall({
    timeoutMs: 100,
    call: async () => {
      attempts += 1;
      const error = new Error("connection broken");
      error.code = "MCP_CONNECTION_CLOSED";
      throw error;
    },
    closeTransport: async () => { closeCalls += 1; },
    reconnect: async () => { reconnectCalls += 1; },
  }), /connection broken/u);
  assert.equal(attempts, 2);
});

test("restricted MCP captures raw results per request despite reverse completion", async () => {
  const ledger = createEvidenceLedger({ provider: "test" });
  const telemetry = createTelemetry({ provider: "test", questionScopeId: ledger.scopeId });
  const safety = createSafetyController();
  const diagnostics = [];
  const handleTool = createRestrictedToolHandler({
    allowedTools: new Set(LEGAL_TOOL_NAMES),
    ledger,
    telemetry,
    safety,
    diagnostic: async (value) => diagnostics.push(value),
    upstream: {
      async callTool({ arguments: args }) {
        await delay(args.query.endsWith("A") ? 50 : 5);
        return { content: [{ type: "text", text: `RAW_${args.query}` }] };
      },
    },
  });
  const [a, b] = await Promise.all([
    handleTool({ name: "search_decisions", args: { domain: "precedent", query: "A" } }),
    handleTool({ name: "search_decisions", args: { domain: "precedent", query: "B" } }),
  ]);
  assert.equal(a.content[0].text, "RAW_A");
  assert.equal(b.content[0].text, "RAW_B");
  assert.deepEqual(diagnostics.map((item) => item.trace.args.query).sort(), ["A", "B"]);
  assert.equal(telemetry.snapshot(ledger).legal_tool_calls, 2);
});

test("search adapter registry requires an explicit supported adapter", () => {
  const registry = createSearchAdapterRegistry();
  assert.throws(() => registry.resolve(), (error) => {
    assert.equal(error instanceof SearchAdapterUnsupportedError, true);
    assert.equal(error.code, "SEARCH_ADAPTER_UNSUPPORTED");
    return true;
  });
  assert.equal(registry.resolve("gemini_d").id, "gemini_d");
  assert.equal(registry.resolve("luna_native").id, "luna_native");
});

function requestJson(port, { method = "GET", pathname = "/health", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers: {
        ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function withTestServer(run) {
  const writes = [];
  const server = http.createServer(createRequestHandler({
    executeQueryImpl: async (query) => {
      if (query === "boom") throw new Error("real server failure");
      return { status: 200, payload: { ok: true, query } };
    },
    healthPayloadImpl: async () => ({ ok: true, source: "test" }),
    adminSettingsViewImpl: () => ({ adapter: "luna_native" }),
    validateAdminPatchImpl: validateAdminPatch,
    writeAdminSettingsImpl: async (values) => {
      writes.push(values);
      return Object.keys(values);
    },
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await run({ port, writes });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("HTTP routes classify malformed, oversized, invalid, and real failures safely", async () => {
  await withTestServer(async ({ port, writes }) => {
    const localHeaders = { host: `127.0.0.1:${port}`, "content-type": "application/json" };
    const malformedAsk = await requestJson(port, { method: "POST", pathname: "/ask", headers: localHeaders, body: "{" });
    assert.equal(malformedAsk.status, 400);
    assert.match(malformedAsk.body, /valid JSON/u);

    const oversizedAsk = await requestJson(port, {
      method: "POST",
      pathname: "/ask",
      headers: localHeaders,
      body: JSON.stringify({ query: "x".repeat(10_001) }),
    });
    assert.equal(oversizedAsk.status, 413);

    const malformedAdmin = await requestJson(port, { method: "POST", pathname: "/admin/config", headers: localHeaders, body: "{" });
    assert.equal(malformedAdmin.status, 400);
    assert.match(malformedAdmin.body, /valid JSON/u);

    const invalidAdmin = await requestJson(port, {
      method: "POST",
      pathname: "/admin/config",
      headers: localHeaders,
      body: JSON.stringify({ PORT: "0" }),
    });
    assert.equal(invalidAdmin.status, 400);
    assert.match(invalidAdmin.body, /ADMIN_SETTING_INVALID:PORT/u);
    assert.doesNotMatch(invalidAdmin.body, /GEMINI_API_KEY|LAW_OC|token/iu);

    const validAdmin = await requestJson(port, {
      method: "POST",
      pathname: "/admin/config",
      headers: localHeaders,
      body: JSON.stringify({ PORT: "3310" }),
    });
    assert.equal(validAdmin.status, 200);
    assert.deepEqual(writes, [{ PORT: "3310" }]);

    const emptyQuery = await requestJson(port, {
      method: "POST",
      pathname: "/ask",
      headers: localHeaders,
      body: JSON.stringify({ query: "" }),
    });
    assert.equal(emptyQuery.status, 400);

    const realFailure = await requestJson(port, {
      method: "POST",
      pathname: "/ask",
      headers: localHeaders,
      body: JSON.stringify({ query: "boom" }),
    });
    assert.equal(realFailure.status, 500);
    assert.match(realFailure.body, /NETWORK_SERVER_ERROR/u);
  });
});

test("HTTP server enforces the actual local Host and Origin", async () => {
  await withTestServer(async ({ port }) => {
    const foreignStatic = await requestJson(port, { pathname: "/", headers: { host: `attacker.example:${port}` } });
    assert.equal(foreignStatic.status, 403);

    const localHealth = await requestJson(port, { pathname: "/health", headers: { host: `127.0.0.1:${port}` } });
    assert.equal(localHealth.status, 200);
    const localhostHealth = await requestJson(port, { pathname: "/health", headers: { host: `localhost:${port}` } });
    assert.equal(localhostHealth.status, 200);

    const body = JSON.stringify({ query: "local" });
    const noOrigin = await requestJson(port, {
      method: "POST",
      pathname: "/ask",
      headers: { host: `localhost:${port}`, "content-type": "application/json" },
      body,
    });
    assert.equal(noOrigin.status, 200);

    for (const pathname of ["/ask", "/ask/stream", "/admin/config"]) {
      const response = await requestJson(port, {
        method: "POST",
        pathname,
        headers: {
          host: `127.0.0.1:${port}`,
          origin: `http://attacker.example:${port}`,
          "content-type": "application/json",
        },
        body: pathname === "/admin/config" ? JSON.stringify({ PORT: "3310" }) : body,
      });
      assert.equal(response.status, 403, pathname);
    }

    const localOrigin = await requestJson(port, {
      method: "POST",
      pathname: "/ask",
      headers: {
        host: `127.0.0.1:${port}`,
        origin: `http://localhost:${port}`,
        "content-type": "application/json",
      },
      body,
    });
    assert.equal(localOrigin.status, 200);
  });
});
