import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, ROOT_DIR } from "../config.js";
import { CODEX_FINAL_SCHEMA } from "./codexFinalSchema.js";
import { isCodexAuthFailure } from "./codexAuth.js";
import { AppServerClient } from "./codexAppServerClient.js";
import {
  appServerRuntimeStatus,
  buildCodexAppServerEnv,
  resolvePackagedCodexRuntime,
} from "./codexRuntimeResolver.js";
import { assertFileCredentialStore } from "./codexAuthIsolation.js";
import { CodexAppServerSession, parseFinalSelection, tokenUsageFromNotification } from "./codexAppServerSession.js";
import { isLunaTerraFallback, normalizeModelResolution } from "./codexModelResolution.js";
import { CodexUsageCollector } from "./codexUsage.js";
import { LEGAL_DYNAMIC_TOOLS } from "./aoV2/legalToolDefinitions.js";

const CLIENT_INFO = Object.freeze({ name: "case-finder", version: "0.1.0" });

function runtimeError(code, message, cause = null) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function createSessionDirectory(baseDir, index) {
  return path.join(baseDir, `${String(index).padStart(3, "0")}-${Date.now()}`);
}

function errorCode(error) {
  return error?.code || String(error?.message || "").split(":", 1)[0];
}

function isProcessFailure(error) {
  return [
    "CODEX_APP_SERVER_PROCESS_FAILED",
    "CODEX_APP_SERVER_PROCESS_CLOSED",
    "CODEX_APP_SERVER_REQUEST_TIMEOUT",
  ].includes(errorCode(error));
}

function threadIdFromMessage(message) {
  const params = message?.params || {};
  return params.threadId || params.thread_id || params.thread?.id || null;
}

function forbiddenItemType(value) {
  const type = String(value || "").toLowerCase().replace(/[-_]/gu, "");
  if (type.includes("commandexecution") || type === "shell") return "command_execution";
  if (type.includes("websearch")) return "web_search";
  if (type.includes("browser")) return "browser";
  if (type.includes("fileread") || type.includes("filewrite") || type.includes("filesearch")) return "file_search";
  if (type.includes("reporead")) return "repo_read";
  if (type.includes("repowrite")) return "repo_write";
  if (type === "git" || type.includes("github")) return type.includes("github") ? "github" : "git";
  return "";
}

export class CodexAppServerRuntime {
  constructor({
    baseDir = config.codexWorkdir,
    codexHomePath = config.codexHomePath,
    configCwd = ROOT_DIR,
    source = process.env,
    spawnImpl = spawn,
    resolveRuntime = resolvePackagedCodexRuntime,
    clientFactory = (child, options) => new AppServerClient(child, options),
    usageCollector = new CodexUsageCollector(),
    requestTimeoutMs = 30_000,
    sessionTimeoutMs = config.codexTimeoutMs,
    dynamicTools = LEGAL_DYNAMIC_TOOLS,
  } = {}) {
    this.baseDir = baseDir;
    this.codexHomePath = codexHomePath;
    this.configCwd = configCwd;
    this.source = source;
    this.spawnImpl = spawnImpl;
    this.resolveRuntime = resolveRuntime;
    this.clientFactory = clientFactory;
    this.usageCollector = usageCollector;
    this.requestTimeoutMs = requestTimeoutMs;
    this.sessionTimeoutMs = sessionTimeoutMs;
    this.dynamicTools = dynamicTools;
    this.runtime = null;
    this.client = null;
    this.startPromise = null;
    this.sessionIndex = 0;
    this.sessions = new Map();
    this.notificationListeners = new Set();
    this.shuttingDown = false;
  }

  async start() {
    if (this.shuttingDown) throw runtimeError("CODEX_APP_SERVER_PROCESS_CLOSED", "Codex app-server runtime is closed");
    if (this.startPromise) return this.startPromise;
    if (this.client && !this.client.closed) return this;
    this.startPromise = (async () => {
      this.runtime = await this.resolveRuntime();
      await fs.mkdir(this.baseDir, { recursive: true });
      const childEnv = await buildCodexAppServerEnv(this.source, { codexHomePath: this.codexHomePath });
      let child;
      try {
        child = this.spawnImpl(this.runtime.executablePath, ["app-server", "--listen", "stdio://"], {
          cwd: ROOT_DIR,
          env: childEnv,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        throw runtimeError("CODEX_APP_SERVER_SPAWN_FAILED", "Codex app-server could not be started", error);
      }
      const client = this.clientFactory(child, {
        onServerRequest: (message) => this.#handleServerRequest(message),
        onNotification: (message) => this.#handleNotification(message),
        onProcessError: (error) => this.#handleProcessError(error),
      });
      try {
        await client.request("initialize", {
          capabilities: { experimentalApi: true },
          clientInfo: CLIENT_INFO,
        }, this.requestTimeoutMs);
        client.notify("initialized");
        let effectiveConfig;
        try {
          effectiveConfig = await client.request("config/read", {
            includeLayers: false,
            cwd: this.configCwd,
          }, this.requestTimeoutMs);
        } catch (error) {
          throw runtimeError("CODEX_AUTH_ISOLATION_UNSAFE", "effective Codex credential store could not be verified", error);
        }
        assertFileCredentialStore(effectiveConfig);
        if (this.shuttingDown) throw runtimeError("CODEX_APP_SERVER_PROCESS_CLOSED", "Codex app-server runtime is closed");
        this.client = client;
      } catch (error) {
        await client.close().catch(() => {});
        this.client = null;
        throw isCodexAuthFailure(error)
          ? runtimeError("CODEX_AUTH_REQUIRED", "Codex authentication is unavailable", error)
          : (error?.code?.startsWith("CODEX_") ? error : runtimeError("CODEX_APP_SERVER_INITIALIZE_FAILED", "Codex app-server initialization failed", error));
      }
      return this;
    })().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async request(method, params = {}, { allowRestart = false, timeoutMs = this.requestTimeoutMs } = {}) {
    let attempt = 0;
    while (true) {
      await this.start();
      try {
        return await this.client.request(method, params, timeoutMs);
      } catch (error) {
        if (!allowRestart || attempt > 0 || !isProcessFailure(error)) throw error;
        attempt += 1;
        await this.restart();
      }
    }
  }

  async restart() {
    const current = this.client;
    this.client = null;
    this.#failSessions(runtimeError("CODEX_APP_SERVER_PROCESS_FAILED", "Codex app-server restarted"));
    await current?.close().catch(() => {});
    return this.start();
  }

  async createSession({
    prompt,
    model = config.codexModel,
    reasoningEffort = config.codexReasoningEffort,
  } = {}) {
    if (!prompt) throw runtimeError("CODEX_APP_SERVER_PROMPT_REQUIRED", "prompt is required");
    await this.start();
    const index = this.sessionIndex++;
    const sessionDir = createSessionDirectory(this.baseDir, index);
    const workdir = path.join(sessionDir, "workdir");
    await fs.mkdir(workdir, { recursive: true });
    let thread;
    try {
      thread = await this.client.request("thread/start", {
        model,
        cwd: workdir,
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "never",
        dynamicTools: this.dynamicTools,
      }, this.requestTimeoutMs);
    } catch (error) {
      await this.cleanupSessionDirectory(sessionDir).catch(() => {});
      throw this.#classifyExecutionError(error, "CODEX_APP_SERVER_THREAD_START_FAILED");
    }
    const threadId = thread?.thread?.id || thread?.id;
    if (!threadId) {
      await this.cleanupSessionDirectory(sessionDir).catch(() => {});
      throw runtimeError("CODEX_APP_SERVER_THREAD_ID_MISSING", "thread/start returned no id");
    }
    const session = new CodexAppServerSession(this, {
      threadId,
      turnId: "pending",
      sessionId: threadId,
      sessionDir,
      timeoutMs: Math.max(1, Number(this.sessionTimeoutMs)),
      requestedModel: model,
      modelResolution: normalizeModelResolution(thread, model),
    });
    this.registerSession(session);
    try {
      const turn = await this.client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: prompt }],
        effort: reasoningEffort,
        outputSchema: CODEX_FINAL_SCHEMA,
      }, Math.max(this.requestTimeoutMs, Number(this.sessionTimeoutMs)));
      const turnId = turn?.turn?.id || turn?.id;
      if (!turnId) throw runtimeError("CODEX_APP_SERVER_TURN_ID_MISSING", "turn/start returned no id");
      session.setTurnId(turnId);
      return session;
    } catch (error) {
      await session.close();
      throw this.#classifyExecutionError(error, "CODEX_APP_SERVER_TURN_START_FAILED");
    }
  }

  registerSession(session) {
    this.sessions.set(String(session.threadId), session);
  }

  unregisterSession(session) {
    if (this.sessions.get(String(session.threadId)) === session) this.sessions.delete(String(session.threadId));
  }

  async cleanupSessionDirectory(sessionDir) {
    if (!sessionDir) return;
    const baseDir = path.resolve(this.baseDir);
    const target = path.resolve(sessionDir);
    if (!target.startsWith(`${baseDir}${path.sep}`)) return;
    await fs.rm(target, { recursive: true, force: true });
  }

  respondToServerRequest(id, result, error = null) {
    if (!this.client || this.client.closed) return;
    this.client.respond(id, result, error);
  }

  onNotification(listener) {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async recordSessionUsage(usage) {
    return this.usageCollector.recordQuery(usage);
  }

  async interruptTurn(session) {
    if (!this.client || this.client.closed || !session?.turnId || session.turnId === "pending") return;
    await this.client.request("turn/interrupt", {
      threadId: session.threadId,
      turnId: session.turnId,
    }, 1_000).catch(() => {});
  }

  async usageSnapshot() {
    return this.usageCollector.snapshot();
  }

  status() {
    return {
      ...appServerRuntimeStatus(this.runtime),
      processAlive: Boolean(this.client && !this.client.closed),
    };
  }

  async inspect() {
    const runtime = await this.resolveRuntime();
    return { ...appServerRuntimeStatus(runtime), executablePath: runtime.executablePath };
  }

  async close() {
    this.shuttingDown = true;
    this.#failSessions(runtimeError("CODEX_APP_SERVER_PROCESS_CLOSED", "Codex app-server runtime closed"));
    const current = this.client;
    this.client = null;
    await current?.close().catch(() => {});
  }

  #handleServerRequest(message) {
    if (message.method !== "item/tool/call") {
      this.client?.respond(message.id, null, { code: -32001, message: "SAFETY_REJECTED" });
      this.#failSessions(runtimeError("CODEX_APP_SERVER_PROTOCOL_CONTAMINATION", `unsupported server request: ${message.method}`));
      return;
    }
    const threadId = threadIdFromMessage(message);
    const session = this.sessions.get(String(threadId || ""));
    if (!session) {
      this.client?.respond(message.id, null, { code: -32002, message: "SESSION_NOT_FOUND" });
      return;
    }
    return session.handleToolCall(message);
  }

  #handleNotification(message) {
    const threadId = threadIdFromMessage(message);
    if (message.method === "item/started" || message.method === "item/completed") {
      const item = message.params?.item || {};
      const forbidden = forbiddenItemType(item.type);
      if (forbidden) this.sessions.get(String(threadId || ""))?.enqueueProtocolEvent(forbidden);
    }
    if (message.method === "thread/tokenUsage/updated") {
      const session = this.sessions.get(String(threadId || ""));
      if (session) session.handleNotification(message);
    } else if (message.method === "turn/completed" || message.method === "turn/failed") {
      const session = this.sessions.get(String(threadId || ""));
      if (session) void session.handleNotification(message);
    }
    for (const listener of this.notificationListeners) {
      try { listener(message); } catch { /* Account notifications must not stop search routing. */ }
    }
  }

  #handleProcessError(error) {
    if (this.client?.closed && !this.shuttingDown) {
      this.#failSessions(error?.code ? error : runtimeError("CODEX_APP_SERVER_PROCESS_FAILED", "Codex app-server process failed", error));
      this.client = null;
    }
  }

  #failSessions(error) {
    for (const session of this.sessions.values()) session.failFromRuntime(error);
    this.sessions.clear();
  }

  #classifyExecutionError(error, fallbackCode) {
    if (isCodexAuthFailure(error)) return runtimeError("CODEX_AUTH_REQUIRED", "Codex authentication is unavailable", error);
    if (error?.code?.startsWith("CODEX_")) return error;
    return runtimeError(fallbackCode, "Codex app-server execution failed", error);
  }
}

let defaultRuntime = null;

export function getDefaultCodexAppServerRuntime(options = {}) {
  if (!defaultRuntime) defaultRuntime = new CodexAppServerRuntime(options);
  return defaultRuntime;
}

export function createCodexAppServerRuntime(options = {}) {
  return new CodexAppServerRuntime(options);
}

export function createCodexAppServerSessionFactory({ runtime, ...options } = {}) {
  const selectedRuntime = runtime || getDefaultCodexAppServerRuntime(options);
  return (sessionOptions = {}) => selectedRuntime.createSession(sessionOptions);
}

export async function inspectPackagedCodexAppServerRuntime(options = {}) {
  const runtime = await resolvePackagedCodexRuntime(options);
  return { ...appServerRuntimeStatus(runtime), executablePath: runtime.executablePath };
}

export async function closeDefaultCodexAppServerRuntime() {
  if (!defaultRuntime) return;
  await defaultRuntime.close();
  defaultRuntime = null;
}

export {
  isLunaTerraFallback,
  normalizeModelResolution,
  parseFinalSelection,
  tokenUsageFromNotification,
};
