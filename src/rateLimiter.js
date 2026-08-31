import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const usagePath = path.join(config.runtimePaths.statePath, "usage.json");
const RPM_WINDOW_MS = 60_000;

export class GeminiLimitExceededError extends Error {
  constructor(reason) {
    super(`Gemini 호출 한도 초과: ${reason}`);
    this.name = "GeminiLimitExceededError";
    this.code = "GEMINI_LIMIT_EXCEEDED";
    this.reason = reason;
  }
}

function pacificDateFor(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function emptyUsage(date = pacificDateFor()) {
  return { date, callsToday: 0, recentCalls: [] };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function abortedError() {
  const error = new Error("Gemini 호출이 취소되었습니다.");
  error.code = "ABORTED";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortedError();
}

function waitWithAbort(wait, milliseconds, signal) {
  if (!signal) return wait(milliseconds);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let abortHandler;
    const cleanup = () => signal.removeEventListener("abort", abortHandler);
    abortHandler = () => {
      cleanup();
      reject(abortedError());
    };
    signal.addEventListener("abort", abortHandler, { once: true });
    Promise.resolve(wait(milliseconds)).then(
      () => {
        cleanup();
        resolve();
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function createGeminiRateLimiter(options = {}) {
  const statePath = options.usageFilePath || usagePath;
  const rpmLimit = Number.isInteger(options.rpmLimit) ? options.rpmLimit : config.geminiRpmLimit;
  const rpdLimit = Number.isInteger(options.rpdLimit) ? options.rpdLimit : config.geminiRpdLimit;
  const rpmWindowMs = Number.isInteger(options.rpmWindowMs) ? options.rpmWindowMs : RPM_WINDOW_MS;
  const rpmWaitMarginMs = Number.isInteger(options.rpmWaitMarginMs)
    ? options.rpmWaitMarginMs
    : config.geminiRpmWaitMarginMs;
  const clock = options.clock || (() => Date.now());
  const wait = options.sleep || sleep;
  let writeQueue = Promise.resolve();

  async function readState(now = clock()) {
    try {
      const parsed = JSON.parse(await fs.readFile(statePath, "utf8"));
      if (!parsed || typeof parsed !== "object") return emptyUsage(pacificDateFor(now));
      const date = pacificDateFor(now);
      if (parsed.date !== date) return emptyUsage(date);
      return {
        date,
        callsToday: Number.isInteger(parsed.callsToday) && parsed.callsToday >= 0 ? parsed.callsToday : 0,
        recentCalls: Array.isArray(parsed.recentCalls) ? parsed.recentCalls.filter((value) => Number.isFinite(value)) : [],
      };
    } catch {
      return emptyUsage(pacificDateFor(now));
    }
  }

  async function writeState(usage) {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(usage, null, 2)}\n`, "utf8");
  }

  function withWriteLock(task) {
    const result = writeQueue.then(task, task);
    writeQueue = result.catch(() => {});
    return result;
  }

  async function reserve(now = clock(), reserveOptions = {}) {
    const abortSignal = reserveOptions.abortSignal || null;
    let waitEvents = 0;
    let waitTotalMs = 0;
    while (true) {
      throwIfAborted(abortSignal);
      const currentNow = waitEvents === 0 ? now : clock();
      const decision = await withWriteLock(async () => {
        throwIfAborted(abortSignal);
        const usage = await readState(currentNow);
        const recentCalls = usage.recentCalls.filter((timestamp) => timestamp > currentNow - rpmWindowMs);
        if (usage.callsToday >= rpdLimit) throw new GeminiLimitExceededError("일일 한도");
        if (recentCalls.length >= rpmLimit) {
          const oldestCall = Math.min(...recentCalls);
          return {
            waiting: true,
            waitMs: Math.max(1, oldestCall + rpmWindowMs - currentNow + rpmWaitMarginMs),
          };
        }
        const nextUsage = {
          ...usage,
          callsToday: usage.callsToday + 1,
          recentCalls: [...recentCalls, currentNow],
        };
        throwIfAborted(abortSignal);
        await writeState(nextUsage);
        return { waiting: false, usage: nextUsage };
      });

      if (!decision.waiting) {
        if (reserveOptions.telemetry && waitEvents > 0) {
          reserveOptions.telemetry.geminiRpmWaitEvents = (reserveOptions.telemetry.geminiRpmWaitEvents || 0) + waitEvents;
          reserveOptions.telemetry.geminiRpmWaitMs = (reserveOptions.telemetry.geminiRpmWaitMs || 0) + waitTotalMs;
        }
        return decision.usage;
      }

      waitEvents += 1;
      waitTotalMs += decision.waitMs;
      await waitWithAbort(wait, decision.waitMs, abortSignal);
    }
  }

  return {
    reserve,
    readUsage: () => readState(clock()),
  };
}

const defaultLimiter = createGeminiRateLimiter();

export function reserveGeminiCall(now = Date.now(), options = {}) {
  return defaultLimiter.reserve(now, options);
}

export async function readGeminiUsage() {
  return defaultLimiter.readUsage();
}
