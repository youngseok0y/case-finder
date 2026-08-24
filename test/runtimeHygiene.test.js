import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import { PassThrough, Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_SERVER_BUFFER_LIMITS,
  createAppServerClient,
} from "../src/codexAppServerClient.js";
import { createAgenticSearchV2 } from "../src/aoV2/index.js";
import { withMcpTimeout } from "../src/mcpClient.js";
import { sanitizeLogValue } from "../src/log.js";
import { createRequestHandler } from "../src/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
