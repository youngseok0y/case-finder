import { createInterface } from "node:readline";

export const APP_SERVER_BUFFER_LIMITS = Object.freeze({
  notifications: 256,
  parseErrors: 64,
  stderrBytes: 64 * 1024,
});

function pushRecent(array, value, limit) {
  array.push(value);
  if (array.length > limit) array.splice(0, array.length - limit);
}

function pushStderr(array, value, limitBytes) {
  array.push(value);
  let totalBytes = array.reduce((sum, item) => sum + Buffer.byteLength(item, "utf8"), 0);
  while (array.length > 1 && totalBytes > limitBytes) {
    totalBytes -= Buffer.byteLength(array.shift(), "utf8");
  }
  if (totalBytes > limitBytes) {
    array[0] = Buffer.from(array[0], "utf8").subarray(-limitBytes).toString("utf8");
  }
}

function protocolError(code, message, cause = null) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function jsonRpcError(message) {
  const error = protocolError(
    message.error?.code === -32601 ? "CODEX_APP_SERVER_METHOD_UNSUPPORTED" : "CODEX_APP_SERVER_REQUEST_FAILED",
    message.error?.message || "Codex app-server request failed",
  );
  error.jsonRpcCode = message.error?.code;
  return error;
}

export class AppServerClient {
  constructor(child, {
    onServerRequest = async () => {},
    onNotification = () => {},
    onProcessError = () => {},
  } = {}) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.parseErrors = [];
    this.stderr = [];
    this.closed = false;
    this.processExited = false;
    this.exitResolve = null;
    this.exitPromise = new Promise((resolve) => { this.exitResolve = resolve; });
    this.onServerRequest = onServerRequest;
    this.onNotification = onNotification;
    this.onProcessError = onProcessError;
    this.rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => this.#handleLine(line));
    child.stderr?.on("data", (chunk) => pushStderr(this.stderr, String(chunk), APP_SERVER_BUFFER_LIMITS.stderrBytes));
    child.on("error", (error) => this.#failAll(this.#classifyProcessError(error)));
    child.on("exit", (code, signal) => {
      this.processExited = true;
      this.exitResolve?.();
      if (this.closed) return;
      this.#failAll(protocolError("CODEX_APP_SERVER_PROCESS_FAILED", `process exited: ${code ?? "null"}:${signal ?? "null"}`));
    });
  }

  #classifyProcessError(error) {
    if (error?.code === "CODEX_APP_SERVER_PROCESS_FAILED") return error;
    return protocolError("CODEX_APP_SERVER_PROCESS_FAILED", error?.message || "Codex app-server process failed", error);
  }

  #failAll(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.onProcessError(error);
  }

  #handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      pushRecent(this.parseErrors, { line: line.slice(0, 500), error: error.message }, APP_SERVER_BUFFER_LIMITS.parseErrors);
      return;
    }

    if (message.method && message.id !== undefined) {
      void Promise.resolve(this.onServerRequest(message)).catch((error) => {
        this.respond(message.id, null, { code: -32001, message: error?.message || "SAFETY_REJECTED" });
      });
      return;
    }
    if (message.method) {
      pushRecent(this.notifications, message, APP_SERVER_BUFFER_LIMITS.notifications);
      this.onNotification(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
      return;
    }
    if (message.id === undefined) return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    clearTimeout(pending.timer);
    if (message.error) pending.reject(jsonRpcError(message));
    else pending.resolve(message.result);
  }

  write(message) {
    if (this.closed || !this.child.stdin?.writable) {
      throw protocolError("CODEX_APP_SERVER_PROCESS_FAILED", "Codex app-server stdin is unavailable");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params = {}) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  respond(id, result, error = null) {
    this.write(error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result });
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (this.closed) return Promise.reject(protocolError("CODEX_APP_SERVER_PROCESS_FAILED", "Codex app-server is closed"));
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(protocolError("CODEX_APP_SERVER_REQUEST_TIMEOUT", method));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  waitForNotification(predicate, timeoutMs = 30_000) {
    const existing = this.notifications.find(predicate);
    if (existing) return Promise.resolve(existing);
    if (this.closed) return Promise.reject(protocolError("CODEX_APP_SERVER_PROCESS_FAILED", "Codex app-server is closed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item.resolve !== resolve);
        reject(protocolError("CODEX_APP_SERVER_REQUEST_TIMEOUT", "notification"));
      }, timeoutMs);
      timer.unref?.();
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  async close() {
    if (!this.closed) {
      this.closed = true;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(protocolError("CODEX_APP_SERVER_PROCESS_CLOSED", "Codex app-server closed"));
      }
      this.pending.clear();
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(protocolError("CODEX_APP_SERVER_PROCESS_CLOSED", "Codex app-server closed"));
      }
      this.rl.close();
      if (!this.child.killed && !this.processExited) this.child.kill();
    }
    if (!this.processExited) {
      await Promise.race([
        this.exitPromise,
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
  }
}

export function createAppServerClient(child, options = {}) {
  return new AppServerClient(child, options);
}
