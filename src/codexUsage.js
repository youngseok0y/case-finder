import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const USAGE_FIELDS = Object.freeze([
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "total_tokens",
]);

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function rawUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

export function normalizeCodexTokenUsage(value) {
  const raw = rawUsage(value);
  if (!raw) return null;
  const normalized = {
    input_tokens: numberValue(raw.input_tokens ?? raw.inputTokens),
    cached_input_tokens: numberValue(raw.cached_input_tokens ?? raw.cachedInputTokens),
    output_tokens: numberValue(raw.output_tokens ?? raw.outputTokens),
    reasoning_tokens: numberValue(raw.reasoning_tokens ?? raw.reasoningTokens ?? raw.reasoning_output_tokens ?? raw.reasoningOutputTokens),
    total_tokens: numberValue(raw.total_tokens ?? raw.totalTokens),
  };
  if (normalized.total_tokens === 0) {
    normalized.total_tokens = normalized.input_tokens
      + normalized.output_tokens
      + normalized.reasoning_tokens;
  }
  return normalized;
}

function kstDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function zeroUsage() {
  return Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
}

function emptyState(date = kstDate()) {
  return {
    date,
    runs: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    latest: null,
    usageSource: "unavailable",
  };
}

function stateFromFile(value, date) {
  if (!value || typeof value !== "object" || value.date !== date) return emptyState(date);
  return {
    ...emptyState(date),
    runs: numberValue(value.runs),
    inputTokens: numberValue(value.inputTokens),
    cachedInputTokens: numberValue(value.cachedInputTokens),
    outputTokens: numberValue(value.outputTokens),
    reasoningTokens: numberValue(value.reasoningTokens),
    totalTokens: numberValue(value.totalTokens),
    latest: normalizeCodexTokenUsage(value.latest),
    usageSource: value.usageSource === "app_server_thread_token_usage" ? value.usageSource : "unavailable",
  };
}

export class CodexUsageCollector {
  constructor({ statePath = path.join(config.runtimePaths.statePath, "codex-usage.json"), fsImpl = fs, now = () => new Date() } = {}) {
    this.statePath = statePath;
    this.fs = fsImpl;
    this.now = now;
    this.writeChain = Promise.resolve();
    this.state = null;
  }

  async read() {
    const date = kstDate(this.now());
    const value = await this.fs.readFile(this.statePath, "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => null);
    this.state = stateFromFile(value, date);
    return { ...this.state };
  }

  async recordQuery(usage) {
    const normalized = normalizeCodexTokenUsage(usage);
    this.writeChain = this.writeChain.then(async () => {
      const current = await this.read();
      current.runs += 1;
      if (normalized) {
        current.inputTokens += normalized.input_tokens;
        current.cachedInputTokens += normalized.cached_input_tokens;
        current.outputTokens += normalized.output_tokens;
        current.reasoningTokens += normalized.reasoning_tokens;
        current.totalTokens += normalized.total_tokens;
        current.latest = normalized;
        current.usageSource = "app_server_thread_token_usage";
      }
      this.state = current;
      await this.#writeAtomic(current);
    });
    await this.writeChain;
    return { ...this.state };
  }

  async snapshot() {
    if (!this.state || this.state.date !== kstDate(this.now())) await this.read();
    return {
      local: { ...this.state },
      source: "local_kst_aggregate",
      usage: this.state.latest ? { ...this.state.latest } : null,
      usage_source: this.state.usageSource,
    };
  }

  async #writeAtomic(value) {
    await this.fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await this.fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await this.fs.rename(temporary, this.statePath);
    } catch (error) {
      await this.fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }
}

export function createCodexUsageCollector(options = {}) {
  return new CodexUsageCollector(options);
}

export { emptyState as emptyCodexUsageState, kstDate as codexUsageDate, zeroUsage };
