import fs from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "../config.js";

const usagePath = path.join(ROOT_DIR, "state", "usage.json");
let writeQueue = Promise.resolve();

export class GeminiLimitExceededError extends Error {
  constructor(reason) {
    super(`Gemini 호출 한도 초과: ${reason}`);
    this.name = "GeminiLimitExceededError";
    this.code = "GEMINI_LIMIT_EXCEEDED";
    this.reason = reason;
  }
}

function pacificDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function emptyUsage(date = pacificDate()) {
  return { date, callsToday: 0, recentCalls: [] };
}

async function readUsage() {
  try {
    const parsed = JSON.parse(await fs.readFile(usagePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return emptyUsage();
    const date = pacificDate();
    if (parsed.date !== date) return emptyUsage(date);
    return {
      date,
      callsToday: Number.isInteger(parsed.callsToday) && parsed.callsToday >= 0 ? parsed.callsToday : 0,
      recentCalls: Array.isArray(parsed.recentCalls) ? parsed.recentCalls.filter((value) => Number.isFinite(value)) : [],
    };
  } catch {
    return emptyUsage();
  }
}

async function writeUsage(usage) {
  await fs.mkdir(path.dirname(usagePath), { recursive: true });
  await fs.writeFile(usagePath, `${JSON.stringify(usage, null, 2)}\n`, "utf8");
}

function withWriteLock(task) {
  const result = writeQueue.then(task, task);
  writeQueue = result.catch(() => {});
  return result;
}

export function reserveGeminiCall(now = Date.now(), options = {}) {
  return withWriteLock(async () => {
    const usage = await readUsage();
    const recentCalls = usage.recentCalls.filter((timestamp) => timestamp > now - 60_000);
    if (usage.callsToday >= config.geminiRpdLimit) {
      throw new GeminiLimitExceededError("일일 한도");
    }
    if (recentCalls.length >= config.geminiRpmLimit) {
      throw new GeminiLimitExceededError("분당 한도");
    }
    if (Number.isInteger(options.questionCalls) && options.questionCalls >= config.agenticCallMax) {
      throw new GeminiLimitExceededError("질문당 한도");
    }
    const nextUsage = {
      ...usage,
      callsToday: usage.callsToday + 1,
      recentCalls: [...recentCalls, now],
    };
    await writeUsage(nextUsage);
    return nextUsage;
  });
}

export async function readGeminiUsage() {
  return readUsage();
}
