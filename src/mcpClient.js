import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config, ROOT_DIR } from "../config.js";
import { logError, logInfo } from "./log.js";
import { buildLegalMcpEnv } from "./runtimeEnv.js";

let client = null;
let transport = null;
let startPromise = null;
let lastToolNames = [];

export function buildMcpServerParameters({
  platform = process.platform,
  source = process.env,
  fsImpl = fs,
  rootDir = ROOT_DIR,
  runtimePaths = config.runtimePaths,
  lawOc = config.lawOc,
} = {}) {
  const env = buildLegalMcpEnv(source, lawOc);
  const upstreamEntry = path.join(rootDir, "node_modules", "korean-law-mcp", "build", "index.js");
  const managedNodePath = runtimePaths?.managedNodePath || "";
  if (platform === "win32" && managedNodePath && fsImpl.existsSync(managedNodePath) && fsImpl.existsSync(upstreamEntry)) {
    return {
      command: managedNodePath,
      args: [upstreamEntry],
      env,
      mode: "managed-node",
    };
  }

  const binPath = platform === "win32"
    ? path.join(rootDir, "node_modules", ".bin", "korean-law-mcp.cmd")
    : path.join(rootDir, "node_modules", ".bin", "korean-law-mcp");
  if (!fsImpl.existsSync(binPath)) {
    throw new Error(`korean-law-mcp executable is missing: ${path.relative(rootDir, binPath)}`);
  }

  if (platform === "win32") {
    return {
      command: source.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", binPath],
      env,
      mode: "npm-bin",
    };
  }
  return { command: binPath, args: [], env, mode: "npm-bin" };
}

export const MCP_CALL_TIMEOUT = "MCP_CALL_TIMEOUT";
export const MCP_CALL_ABORTED = "ABORTED";

function abortedError() {
  const error = new Error("MCP call aborted");
  error.code = MCP_CALL_ABORTED;
  return error;
}

export function withMcpTimeout(promise, timeoutMs, signal = null) {
  if (signal?.aborted) return Promise.reject(abortedError());
  let timer = null;
  let abortHandler = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`MCP call timed out after ${timeoutMs}ms`);
      error.code = MCP_CALL_TIMEOUT;
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => reject(abortedError());
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise, abortPromise]).finally(() => {
    if (timer) clearTimeout(timer);
    if (abortHandler) signal?.removeEventListener("abort", abortHandler);
  });
}

export function isMcpTransportFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  if (code === MCP_CALL_TIMEOUT) return false;
  if (/^(?:MCP_TRANSPORT|MCP_CONNECTION|ERR_STREAM|ECONNRESET|EPIPE|ERR_IPC_CHANNEL_CLOSED)/u.test(code)) return true;
  return /(?:transport|connection|disconnected|broken pipe|premature close|channel closed)/iu.test(String(error?.message || ""));
}

export async function runMcpCall({
  call,
  timeoutMs,
  closeTransport = async () => {},
  reconnect = async () => {},
  beforeRetry = async () => {},
  signal = null,
} = {}) {
  try {
    return await withMcpTimeout(Promise.resolve().then(call), timeoutMs, signal);
  } catch (error) {
    if (error?.code === MCP_CALL_TIMEOUT || !isMcpTransportFailure(error)) throw error;
    await beforeRetry(error);
    await closeTransport();
    await reconnect();
    return withMcpTimeout(Promise.resolve().then(call), timeoutMs, signal);
  }
}

export async function closeStaleTransport(staleTransport, onError = () => {}) {
  if (!staleTransport || typeof staleTransport.close !== "function") return;
  try {
    await staleTransport.close();
  } catch (error) {
    onError(error);
  }
}

async function connectOnce() {
  const params = buildMcpServerParameters();
  const nextTransport = new StdioClientTransport(params);
  const nextClient = new Client(
    { name: "fable-case-finder", version: "0.1.0" },
    { capabilities: {} },
  );

  nextTransport.onerror = (error) => {
    void logError("korean-law-mcp process error", error);
  };
  nextTransport.onclose = () => {
    if (transport === nextTransport) {
      client = null;
      transport = null;
    }
    logInfo("korean-law-mcp connection closed.");
  };

  await nextClient.connect(nextTransport);
  const listed = await nextClient.listTools();
  lastToolNames = (listed.tools || []).map((tool) => tool.name);
  client = nextClient;
  transport = nextTransport;
  logInfo(`korean-law-mcp connected (${lastToolNames.length} tools)`);
}

export async function startMcp({ probe = false } = {}) {
  if (client) return;
  if (!startPromise) {
    startPromise = connectOnce().finally(() => {
      startPromise = null;
    });
  }
  await startPromise;

  if (probe && config.lawOc) {
    const result = await callTool("search_law", { query: config.mcpProbeQuery, display: 1 });
    const text = result.content?.find((item) => item.type === "text")?.text || "";
    if (result.isError || !text || text.includes("[NOT_FOUND]")) {
      throw new Error("M0 MCP probe failed");
    }
    logInfo(`M0 MCP probe passed: search_law("${config.mcpProbeQuery}")`);
  } else if (probe) {
    logInfo("M0 MCP probe skipped because LAW_OC is not configured.");
  }
}

async function invalidateMcpTransport() {
  const staleTransport = transport;
  client = null;
  transport = null;
  await closeStaleTransport(staleTransport, (closeError) => {
    void logError("stale korean-law-mcp connection cleanup failed", closeError);
  });
}

export async function callTool(name, args = {}, timeoutOrOptions = config.mcpTimeoutMs, options = {}) {
  const timeoutMs = typeof timeoutOrOptions === "number" ? timeoutOrOptions : config.mcpTimeoutMs;
  const signal = typeof timeoutOrOptions === "object" ? timeoutOrOptions?.signal || null : options.signal || null;
  if (signal?.aborted) throw abortedError();
  await startMcp();
  return runMcpCall({
    timeoutMs,
    signal,
    call: () => {
      if (!client) {
        const error = new Error("MCP transport is unavailable");
        error.code = "MCP_TRANSPORT_UNAVAILABLE";
        throw error;
      }
      return client.callTool({ name, arguments: args }, undefined, { signal });
    },
    beforeRetry: (error) => logError(`MCP call failed; reconnecting once: ${name}`, error),
    closeTransport: invalidateMcpTransport,
    reconnect: startMcp,
  });
}

export function getMcpStatus() {
  return {
    connected: Boolean(client),
    tools: [...lastToolNames],
  };
}

export async function closeMcp() {
  await invalidateMcpTransport();
}
