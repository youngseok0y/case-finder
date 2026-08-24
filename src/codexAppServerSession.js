import { isCodexAuthFailure } from "./codexAuth.js";
import { normalizeModelResolution } from "./codexModelResolution.js";
import { normalizeCodexTokenUsage } from "./codexUsage.js";
import { LEGAL_TOOL_NAMES } from "./aoV2/legalToolDefinitions.js";

function runtimeError(code, message, cause = null) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function tokenUsageFromNotification(message) {
  const params = message?.params || {};
  const raw = params.tokenUsage
    || params.token_usage
    || params.usage
    || params.thread?.tokenUsage
    || params.thread?.token_usage
    || params.payload?.tokenUsage
    || null;
  return normalizeCodexTokenUsage(raw);
}

function turnIdFromMessage(message) {
  const params = message?.params || {};
  return params.turnId || params.turn_id || params.turn?.id || null;
}

function finalTextFromTurn(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  return items
    .filter((item) => ["agentMessage", "agent_message"].includes(String(item?.type || "")))
    .map((item) => item?.text)
    .filter((value) => typeof value === "string" && value.trim())
    .at(-1) || "";
}

export function parseFinalSelection(value) {
  const text = String(value || "").trim();
  const candidates = [text, text.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu)?.[1] || ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next supported JSON representation.
    }
  }
  throw runtimeError("CODEX_APP_SERVER_FINAL_INVALID", "turn completed without valid JSON final response");
}

function toolResultText(result) {
  if (typeof result?.rawText === "string" && result.rawText) return result.rawText;
  try {
    return JSON.stringify(result ?? {});
  } catch {
    return "TOOL_ERROR:result serialization failed";
  }
}

export class CodexAppServerSession {
  constructor(runtime, { threadId, turnId, sessionId, sessionDir, timeoutMs, requestedModel, modelResolution }) {
    this.runtime = runtime;
    this.threadId = threadId;
    this.turnId = turnId;
    this.sessionId = sessionId || threadId;
    this.sessionDir = sessionDir || "";
    this.timeoutMs = timeoutMs;
    this.queue = [];
    this.waiters = [];
    this.calls = new Map();
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.#fail(runtimeError("CODEX_APP_SERVER_TURN_TIMEOUT", "Codex app-server turn timed out"));
    }, timeoutMs);
    this.timer.unref?.();
    this.ended = false;
    this.closed = false;
    this.terminalError = null;
    this.finalQueued = false;
    this.usage = null;
    this.requestedModel = normalizeModelResolution({}, requestedModel).requestedModel;
    this.modelResolution = modelResolution || normalizeModelResolution({}, this.requestedModel);
    this.cleanupPromise = null;
  }

  #enqueue(value) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(value);
    else this.queue.push(value);
  }

  #complete() {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timer);
    this.runtime.unregisterSession(this);
    void this.cleanup().catch(() => {});
    for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
  }

  cleanup() {
    if (!this.cleanupPromise) this.cleanupPromise = this.runtime.cleanupSessionDirectory(this.sessionDir);
    return this.cleanupPromise;
  }

  #fail(error) {
    if (this.terminalError || this.ended) return;
    const shouldInterrupt = !this.closed && this.turnId && this.turnId !== "pending";
    this.terminalError = error;
    this.ended = true;
    clearTimeout(this.timer);
    this.runtime.unregisterSession(this);
    void (shouldInterrupt ? this.runtime.interruptTurn(this) : Promise.resolve())
      .catch(() => {})
      .then(() => this.cleanup())
      .catch(() => {});
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  async handleToolCall(message) {
    if (this.ended || this.closed) {
      this.runtime.respondToServerRequest(message.id, null, { code: -32002, message: "SESSION_ENDED" });
      return;
    }
    const params = message.params || {};
    const callId = params.callId || params.call_id || message.id;
    const name = String(params.tool || params.name || "");
    const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? params.arguments
      : {};
    this.calls.set(String(callId), { requestId: message.id, name });
    this.#enqueue({ type: "tool_call", delegated: false, call_id: callId, name, arguments: args });
    if (!LEGAL_TOOL_NAMES.includes(name)) {
      this.runtime.respondToServerRequest(message.id, {
        contentItems: [{ type: "inputText", text: "SAFETY_REJECTED" }],
        success: false,
      });
      this.calls.delete(String(callId));
    }
  }

  async handleNotification(message) {
    if (this.ended && message.method !== "turn/completed") return;
    if (message.method === "thread/tokenUsage/updated") {
      this.usage = tokenUsageFromNotification(message) || this.usage;
      return;
    }
    if (message.method === "turn/failed") {
      const failure = message.params?.turn?.error || message.params?.error || message.params?.turn || {};
      this.#fail(isCodexAuthFailure(failure)
        ? runtimeError("CODEX_AUTH_REQUIRED", "Codex authentication is unavailable")
        : runtimeError("CODEX_APP_SERVER_TURN_FAILED", "Codex app-server turn failed"));
      return;
    }
    if (message.method !== "turn/completed") return;
    const turn = message.params?.turn || {};
    if (String(turn.id || turnIdFromMessage(message) || "") !== String(this.turnId)) return;
    const turnResolution = normalizeModelResolution(turn, this.requestedModel);
    if (turnResolution.hasSignal) {
      const requestedModel = turnResolution.requestedModel || this.modelResolution.requestedModel;
      const effectiveModel = turnResolution.effectiveModel || this.modelResolution.effectiveModel;
      this.modelResolution = normalizeModelResolution({ requestedModel, effectiveModel }, requestedModel);
    }
    if (String(turn.status || "completed") !== "completed") {
      this.#fail(runtimeError("CODEX_APP_SERVER_TURN_FAILED", `turn status: ${turn.status || "unknown"}`));
      return;
    }
    try {
      const selection = parseFinalSelection(finalTextFromTurn(turn));
      await this.runtime.recordSessionUsage(this.usage);
      this.#enqueue({
        type: "final",
        selection,
        usage: this.usage,
        elapsedMs: Date.now() - this.startedAt,
        session_id: this.sessionId,
        modelResolution: this.modelResolution,
      });
      this.finalQueued = true;
      this.#complete();
    } catch (error) {
      this.#fail(error);
    }
  }

  failFromRuntime(error) {
    this.#fail(error);
  }

  enqueueProtocolEvent(type) {
    if (this.ended || this.closed) return;
    this.#enqueue({ type, raw: { type } });
  }

  async next() {
    if (this.queue.length) return this.queue.shift();
    if (this.terminalError) throw this.terminalError;
    if (this.ended) return null;
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  async respondToToolCall({ callId, result } = {}) {
    const key = String(callId || "");
    const call = this.calls.get(key);
    if (!call) throw runtimeError("CODEX_APP_SERVER_TOOL_CALL_UNKNOWN", "tool call id was not found");
    this.calls.delete(key);
    this.runtime.respondToServerRequest(call.requestId, {
      contentItems: [{ type: "inputText", text: toolResultText(result) }],
      success: !result?.isError,
    });
  }

  async close() {
    if (this.closed) return;
    const shouldInterrupt = !this.ended && this.turnId && this.turnId !== "pending";
    this.closed = true;
    clearTimeout(this.timer);
    this.runtime.unregisterSession(this);
    if (shouldInterrupt) await this.runtime.interruptTurn(this).catch(() => {});
    await this.cleanup().catch(() => {});
    for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
  }
}
