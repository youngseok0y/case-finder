import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGeminiRateLimiter, GeminiLimitExceededError } from "../src/rateLimiter.js";
import { generateContent } from "../src/gemini.js";

function pacificDate(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function withLimiter(seed, options, test) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-m6d-rpm-"));
  const usageFilePath = path.join(directory, "usage.json");
  const clockState = { now: Date.now() };
  const sleeps = [];
  const clock = () => clockState.now;
  const advance = (milliseconds) => { clockState.now += milliseconds; };
  await fs.writeFile(usageFilePath, `${JSON.stringify({ date: pacificDate(clockState.now), ...seed })}\n`, "utf8");
  const limiter = createGeminiRateLimiter({
    usageFilePath,
    clock,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      advance(milliseconds);
    },
    rpmLimit: 1,
    rpdLimit: 10,
    questionLimit: 6,
    rpmWindowMs: 1_000,
    rpmWaitMarginMs: 10,
    ...options,
  });
  try {
    await test({ limiter, clockState, clock, advance, sleeps, usageFilePath });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function testRpmFullWaits() {
  await withLimiter({ callsToday: 0, recentCalls: [Date.now() - 900] }, {}, async ({ limiter, sleeps, clockState }) => {
    const telemetry = {};
    await limiter.reserve(clockState.now, { telemetry });
    assert.equal(sleeps.length, 1);
    assert.equal(telemetry.geminiRpmWaitEvents, 1);
    assert.ok(telemetry.geminiRpmWaitMs > 0 && telemetry.geminiRpmWaitMs <= 200);
    assert.equal(telemetry.geminiRpmWaitMs, sleeps[0]);
    assert.equal((await limiter.readUsage()).callsToday, 1);
  });
}

async function testRpmWaitReleasesWriteLock() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-m6d-lock-"));
  const usageFilePath = path.join(directory, "usage.json");
  const clockState = { now: Date.now() };
  await fs.writeFile(usageFilePath, `${JSON.stringify({ date: pacificDate(clockState.now), callsToday: 0, recentCalls: [clockState.now - 900] })}\n`, "utf8");
  let releaseSleep;
  let sleepStarted;
  const sleepReady = new Promise((resolve) => { sleepStarted = resolve; });
  const limiter = createGeminiRateLimiter({
    usageFilePath,
    clock: () => clockState.now,
    sleep: async () => {
      sleepStarted();
      await new Promise((resolve) => { releaseSleep = resolve; });
      clockState.now += 110;
    },
    rpmLimit: 1,
    rpdLimit: 10,
    rpmWindowMs: 1_000,
    rpmWaitMarginMs: 10,
  });
  try {
    const reservation = limiter.reserve(clockState.now);
    await sleepReady;
    const read = await limiter.readUsage();
    assert.equal(read.callsToday, 0);
    releaseSleep();
    await reservation;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

async function testHardStopsAndQuestionLimits() {
  await withLimiter({ callsToday: 10, recentCalls: [] }, { rpdLimit: 10 }, async ({ limiter }) => {
    await assert.rejects(limiter.reserve(), (error) => error instanceof GeminiLimitExceededError && error.reason === "일일 한도");
  });
  await withLimiter({ callsToday: 9, recentCalls: [] }, { rpdLimit: 10 }, async ({ limiter }) => {
    await assert.rejects(limiter.reserve(undefined, { rpdReserve: 1 }), (error) => error instanceof GeminiLimitExceededError && error.reason === "일일 reserve");
  });
  await withLimiter({ callsToday: 0, recentCalls: [] }, {}, async ({ limiter }) => {
    await assert.rejects(limiter.reserve(undefined, { questionCalls: 6 }), (error) => error instanceof GeminiLimitExceededError && error.reason === "질문당 한도");
  });
  await withLimiter({ callsToday: 0, recentCalls: [] }, {}, async ({ limiter }) => {
    await limiter.reserve(undefined, { questionCalls: 100, enforceQuestionLimit: false });
    assert.equal((await limiter.readUsage()).callsToday, 1);
  });
}

async function testRetryPacesAndCounts() {
  await withLimiter({ callsToday: 0, recentCalls: [] }, {}, async ({ limiter, sleeps }) => {
    let providerCalls = 0;
    const telemetry = {};
    const result = await generateContent({}, {
      generate: async () => {
        providerCalls += 1;
        if (providerCalls === 1) {
          const error = new Error("429 resource exhausted");
          error.status = 429;
          throw error;
        }
        return { text: "{}", usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } };
      },
      reserveGeminiCall: limiter.reserve,
      retryDelayMs: 0,
      sleep: async () => {},
      telemetry,
      returnMeta: true,
      enforceQuestionLimit: false,
    });
    assert.equal(result.callsUsed, 2);
    assert.equal(providerCalls, 2);
    assert.equal(telemetry.geminiRequests, 2);
    assert.equal(telemetry.geminiRetryRequests, 1);
    assert.equal(telemetry.geminiRpmWaitEvents, 1);
    assert.equal(sleeps.length, 1);
    assert.equal((await limiter.readUsage()).callsToday, 2);
  });

  await withLimiter({ callsToday: 0, recentCalls: [] }, {}, async ({ limiter }) => {
    let providerCalls = 0;
    const result = await generateContent({}, {
      generate: async () => {
        providerCalls += 1;
        if (providerCalls === 1) {
          const error = new Error("429 resource exhausted");
          error.status = 429;
          throw error;
        }
        return { text: "{}" };
      },
      reserveGeminiCall: limiter.reserve,
      retryDelayMs: 0,
      sleep: async () => {},
      questionCalls: 4,
      enforceQuestionLimit: true,
      returnMeta: true,
    });
    assert.equal(result.callsUsed, 2);
    assert.equal((await limiter.readUsage()).callsToday, 2);
  });

  await withLimiter({ callsToday: 0, recentCalls: [] }, {}, async ({ limiter }) => {
    let providerCalls = 0;
    await assert.rejects(generateContent({}, {
      generate: async () => {
        providerCalls += 1;
        const error = new Error("429 resource exhausted");
        error.status = 429;
        throw error;
      },
      reserveGeminiCall: limiter.reserve,
      retryDelayMs: 0,
      sleep: async () => {},
      questionCalls: 5,
      enforceQuestionLimit: true,
    }), (error) => error instanceof GeminiLimitExceededError && error.reason === "질문당 한도");
    assert.equal(providerCalls, 1);
    assert.equal((await limiter.readUsage()).callsToday, 1);
  });
}

await testRpmFullWaits();
await testRpmWaitReleasesWriteLock();
await testHardStopsAndQuestionLimits();
await testRetryPacesAndCounts();
console.log(JSON.stringify({
  checkpoint: "M6D_RPM_PACER_READY",
  tests: [
    "test_rpm_full_waits_instead_of_throwing",
    "test_wait_does_not_hold_usage_write_lock",
    "test_rpd_limit_still_throws",
    "test_rpd_reserve_still_throws",
    "test_a6_question_limit_still_six",
    "test_ao_has_no_fixed_question_limit",
    "test_retry_passes_rpm_pacer_again",
    "test_retry_counts_as_gemini_request",
    "test_rpm_wait_ms_is_recorded",
    "test_rpm_wait_event_count_is_recorded",
  ],
}, null, 2));
