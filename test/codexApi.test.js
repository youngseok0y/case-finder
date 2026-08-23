import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRequestHandler, healthPayload } from "../src/server.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("Codex account and usage routes expose safe app-server metadata", async () => {
  const calls = [];
  const account = {
    loggedIn: true,
    requiresOpenaiAuth: false,
    email: "user@example.com",
    planType: "pro",
    type: "chatgpt",
    authMode: "chatgpt",
    codexWeekly: {
      available: true,
      usedPercent: 37,
      remainingPercent: 63,
      resetsAt: 1789889511,
      resetLabel: "2026년 8월 28일 오후 3:20",
    },
  };
  const manager = {
    async read() { calls.push("read"); return account; },
    async readRateLimits() { calls.push("rate"); return { source: "app_server", codexWeekly: account.codexWeekly }; },
    async startLogin(type) { calls.push(`login:${type}`); return { type, loginId: "login-1", authUrl: "https://example.test/login", source: "app_server" }; },
    async cancelLogin(loginId) { calls.push(`cancel:${loginId}`); return { cancelled: true, source: "app_server" }; },
    async logout() { calls.push("logout"); return { loggedIn: false, requiresOpenaiAuth: true, email: "", planType: "unknown", type: "", authMode: "logged_out" }; },
  };
  const runtime = {
    async usageSnapshot() {
      return {
        source: "local_kst_aggregate",
        usage: null,
        usage_source: "unavailable",
        local: { date: "2026-08-21", runs: 2, totalTokens: 0 },
      };
    },
  };
  const server = http.createServer(createRequestHandler({
    codexRuntimeImpl: () => runtime,
    codexAccountManagerImpl: () => manager,
  }));
  const port = await listen(server);
  try {
    const accountResponse = await fetch(`http://127.0.0.1:${port}/api/codex/account`);
    const accountBody = await accountResponse.json();
    assert.equal(accountResponse.status, 200);
    assert.equal(accountBody.email, "user@example.com");
    assert.equal("accessToken" in accountBody, false);
    assert.equal(accountBody.codexWeekly.remainingPercent, 63);
    assert.equal("resetsAt" in accountBody.codexWeekly, false);

    const usageResponse = await fetch(`http://127.0.0.1:${port}/api/codex/usage`);
    const usageBody = await usageResponse.json();
    assert.equal(usageBody.local.runs, 2);

    const rateResponse = await fetch(`http://127.0.0.1:${port}/api/codex/rate-limits`);
    const rateBody = await rateResponse.json();
    assert.equal(rateBody.codexWeekly.remainingPercent, 63);
    assert.equal("limits" in rateBody, false);

    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/codex/login/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "chatgpt" }),
    });
    assert.equal((await loginResponse.json()).loginId, "login-1");

    const cancelResponse = await fetch(`http://127.0.0.1:${port}/api/codex/login/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginId: "login-1" }),
    });
    assert.equal((await cancelResponse.json()).cancelled, true);

    const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/codex/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal((await logoutResponse.json()).authMode, "logged_out");
    assert.equal(calls.includes("rate"), true);
  } finally {
    await close(server);
  }
});

test("public health exposes only normalized Codex weekly status, never account email", async () => {
  const manager = {
    async read() {
      return {
        loggedIn: true,
        email: "user@example.com",
        codexWeekly: { available: true, remainingPercent: 63 },
      };
    },
  };
  const health = await healthPayload({
    codexAccountManagerImpl: () => manager,
    codexRuntimeImpl: () => ({ inspect: async () => ({ available: true, transport: "app_server" }) }),
  });
  assert.equal(health.quota.codexWeekly.available, true);
  assert.equal(health.quota.codexWeekly.remainingPercent, 63);
  assert.equal("email" in health, false);
  assert.equal("email" in health.quota.codexWeekly, false);
});
