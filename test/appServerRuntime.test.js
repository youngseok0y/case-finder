import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable, PassThrough } from "node:stream";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CodexAppServerRuntime,
  parseFinalSelection,
} from "../src/codexAppServerRuntime.js";
import {
  createCodexAccountManager,
  formatCodexResetLabel,
  normalizeCodexAccount,
  normalizeCodexRateLimits,
  normalizeCodexWeeklyQuota,
} from "../src/codexAccount.js";
import { createLegalDynamicTools, LEGAL_TOOL_NAMES } from "../src/aoV2/legalToolDefinitions.js";
import { createCodexUsageCollector, normalizeCodexTokenUsage } from "../src/codexUsage.js";

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
  } finally {
    await runtime.close();
    await fs.rm(root, { recursive: true, force: true });
  }
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
  assert.equal(limits.codexWeekly.available, false);
  assert.equal(login.loginId, "login-1");
  assert.equal(JSON.stringify(manager.snapshot()).includes("accessToken"), false);
  assert.deepEqual(normalizeCodexAccount({ account: { type: "chatgpt", email: null }, requiresOpenaiAuth: true }).loggedIn, true);
  assert.equal(normalizeCodexRateLimits({ rateLimits: { primary: { usedPercent: 1 } } }).limits.primary.usedPercent, 1);
  assert.equal(calls.some((item) => item.method === "account/read"), true);
  manager.close();
  assert.equal(listeners.size, 0);
});

test("weekly quota normalization accepts only the seven-day window", () => {
  const reset = Date.parse("2026-08-28T06:20:00.000Z") / 1_000;
  const w1 = normalizeCodexWeeklyQuota({
    rateLimits: {
      primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: reset },
      secondary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: reset },
    },
  });
  assert.deepEqual(w1, {
    available: true,
    usedPercent: 37,
    remainingPercent: 63,
    resetsAt: reset,
    resetLabel: "2026년 8월 28일 오후 3:20",
  });

  const w2 = normalizeCodexWeeklyQuota({
    rateLimits: {
      primary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: reset },
      secondary: { usedPercent: 91, windowDurationMins: 43200, resetsAt: reset },
    },
  });
  assert.equal(w2.remainingPercent, 63);
  assert.equal(w2.resetsAt, reset);

  const w3 = normalizeCodexWeeklyQuota({
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: reset } },
    },
  });
  assert.equal(w3.available, true);
  assert.equal(w3.remainingPercent, 63);

  const w4 = normalizeCodexWeeklyQuota({
    rateLimits: {
      primary: { usedPercent: 20, windowDurationMins: 300 },
      secondary: { usedPercent: 80, windowDurationMins: 43200 },
    },
  });
  assert.deepEqual(w4, {
    available: false,
    usedPercent: null,
    remainingPercent: null,
    resetsAt: null,
    resetLabel: "",
  });
  assert.equal(normalizeCodexWeeklyQuota({ rateLimits: { primary: { usedPercent: -5, windowDurationMins: 10080 } } }).usedPercent, 0);
  assert.equal(normalizeCodexWeeklyQuota({ rateLimits: { primary: { usedPercent: 140, windowDurationMins: 10080 } } }).remainingPercent, 0);
  assert.match(formatCodexResetLabel(reset), /2026년 8월 28일 오후 3:20/u);
});

test("account notifications invalidate stale state and refresh account plus weekly quota", async () => {
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
  assert.equal(snapshot.codexWeekly.remainingPercent, 63);
  assert.ok(accountReads >= 2);
  assert.ok(rateReads >= 2);
  manager.close();
});

test("final parser accepts the frozen JSON response shape", () => {
  assert.deepEqual(parseFinalSelection("```json\n{\"selected\":[]}\n```"), { selected: [] });
});
