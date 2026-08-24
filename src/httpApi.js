import fs from "node:fs/promises";
import path from "node:path";
import { config, EXPECTED_NODE_VERSION, ROOT_DIR } from "../config.js";
import { readGeminiUsage } from "./rateLimiter.js";
import { getMcpStatus } from "./mcpClient.js";
import { logError } from "./log.js";
import { getDefaultCodexAppServerRuntime } from "./codexAppServerRuntime.js";
import { getDefaultCodexAccountManager } from "./codexAccount.js";
import { adminSettingsView, validateAdminPatch, writeAdminSettings } from "./adminConfig.js";
import {
  LUNA_APP_SERVER_RUNTIME_MESSAGE,
  LUNA_AUTH_REQUIRED_MESSAGE,
  LUNA_RUNTIME_ERROR_MESSAGE,
  PRODUCT_SERVICE,
} from "./productMessages.js";
import { executeQuery } from "./queryExecution.js";

const publicRoot = path.join(ROOT_DIR, "public");
const maxBodyBytes = 10_000;
const REQUEST_BODY_TOO_LARGE = "REQUEST_BODY_TOO_LARGE";
const MALFORMED_JSON = "MALFORMED_JSON";

class HttpRequestError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const PUBLIC_ASSETS = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/admin": ["admin.html", "text/html; charset=utf-8"],
  "/admin.html": ["admin.html", "text/html; charset=utf-8"],
  "/admin.js": ["admin.js", "text/javascript; charset=utf-8"],
});

function sendJson(response, statusCode, payload) {
  if (response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendSse(response, event, payload) {
  if (response.writableEnded) return;
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

async function readBody(request) {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume();
    throw new HttpRequestError(REQUEST_BODY_TOO_LARGE, 413, "Request body is too large.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      request.resume();
      throw new HttpRequestError(REQUEST_BODY_TOO_LARGE, 413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function parseJsonBody(request) {
  const raw = await readBody(request);
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpRequestError(MALFORMED_JSON, 400, "Request body must be valid JSON.");
  }
}

function adapterLabel(adapter) {
  return adapter === "gemini_d" ? "Gemini 빠른 검색" : "Luna 고정밀 검색";
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function codexQuotaApiView(quota) {
  const windowKind = ["weekly", "monthly", "other", "unknown"].includes(quota?.windowKind)
    ? quota.windowKind
    : "unknown";
  const usedPercent = finiteNumber(quota?.usedPercent);
  const remainingPercent = finiteNumber(quota?.remainingPercent);
  const windowDurationMins = finiteNumber(quota?.windowDurationMins);
  return {
    available: quota?.available === true,
    usedPercent: usedPercent === null ? null : Math.min(100, Math.max(0, usedPercent)),
    remainingPercent: remainingPercent === null ? null : Math.min(100, Math.max(0, remainingPercent)),
    windowDurationMins: windowDurationMins === null || windowDurationMins <= 0 ? null : windowDurationMins,
    windowKind,
    windowLabel: typeof quota?.windowLabel === "string" ? quota.windowLabel : "",
    resetLabel: typeof quota?.resetLabel === "string" ? quota.resetLabel : "",
  };
}

function codexAccountApiView(account) {
  return {
    loggedIn: account?.loggedIn === true,
    requiresOpenaiAuth: account?.requiresOpenaiAuth === true,
    email: typeof account?.email === "string" ? account.email : "",
    planType: typeof account?.planType === "string" ? account.planType : "unknown",
    type: typeof account?.type === "string" ? account.type : "",
    authMode: typeof account?.authMode === "string" ? account.authMode : "unknown",
    codexQuota: codexQuotaApiView(account?.codexQuota),
    pendingLogin: account?.pendingLogin === true,
  };
}

function codexQuotaHealthView(account) {
  const quota = codexQuotaApiView(account?.codexQuota);
  const loggedIn = account?.loggedIn === true;
  return {
    loggedIn,
    available: loggedIn && quota.available === true,
    remainingPercent: loggedIn ? quota.remainingPercent : null,
    windowKind: loggedIn ? quota.windowKind : "unknown",
    windowLabel: loggedIn ? quota.windowLabel : "",
  };
}

async function quotaStatus({
  codexAccountManagerImpl = getDefaultCodexAccountManager,
  codexRuntimeImpl = getDefaultCodexAppServerRuntime,
} = {}) {
  let gemini;
  try {
    const usage = await readGeminiUsage();
    const usedPercent = Math.min(100, Math.max(0, Math.round((usage.callsToday / config.geminiRpdLimit) * 100)));
    gemini = {
      label: `${Math.max(0, 100 - usedPercent)}% 남음 · 로컬 추정`,
      source: "local_estimate",
      callsToday: usage.callsToday,
      dailyLimit: config.geminiRpdLimit,
    };
  } catch {
    gemini = { label: "Gemini 사용량 확인 불가", source: "unavailable" };
  }
  let codexQuota = { loggedIn: false, available: false, remainingPercent: null, windowKind: "unknown", windowLabel: "" };
  try {
    codexQuota = codexQuotaHealthView(await codexAccountManagerImpl().read());
  } catch {
    // Health remains available when app-server account/quota is unavailable.
  }
  return {
    gemini,
    codexQuota,
  };
}

export async function healthPayload({
  codexAccountManagerImpl = getDefaultCodexAccountManager,
  codexRuntimeImpl = getDefaultCodexAppServerRuntime,
} = {}) {
  let luna = {
    configured: false,
    codexAvailable: false,
    transport: "app_server",
    dynamicTools: false,
    version: "",
  };
  if (config.searchAdapter === "luna_native") {
    try {
      const runtime = await codexRuntimeImpl().inspect();
      luna = {
        configured: true,
        codexAvailable: runtime.available,
        transport: runtime.transport,
        dynamicTools: runtime.dynamicTools,
        version: runtime.version,
        package: runtime.packageName,
        target: runtime.target,
      };
    } catch (error) {
      luna = {
        configured: true,
        codexAvailable: false,
        transport: "app_server",
        dynamicTools: false,
        version: "",
        errorCode: error.code || "CODEX_APP_SERVER_RUNTIME_UNAVAILABLE",
      };
    }
  }
  return {
    service: PRODUCT_SERVICE,
    ok: true,
    node: process.version,
    expectedNode: EXPECTED_NODE_VERSION,
    adapter: { id: config.searchAdapter, label: adapterLabel(config.searchAdapter) },
    mcp: getMcpStatus(),
    codex: { ...luna, transport: "app_server" },
    luna,
    quota: await quotaStatus({ codexAccountManagerImpl, codexRuntimeImpl }),
  };
}

function errorCode(error) {
  return error?.code || String(error?.message || "").split(":", 1)[0];
}

function runtimeFailure(error) {
  return config.searchAdapter === "luna_native" && [
    "CODEX_APP_SERVER_RUNTIME_UNAVAILABLE",
    "CODEX_APP_SERVER_PLATFORM_UNSUPPORTED",
    "CODEX_APP_SERVER_SPAWN_FAILED",
    "CODEX_APP_SERVER_INITIALIZE_FAILED",
    "CODEX_APP_SERVER_PROCESS_FAILED",
    "CODEX_APP_SERVER_PROCESS_CLOSED",
    "CODEX_APP_SERVER_REQUEST_FAILED",
    "CODEX_APP_SERVER_METHOD_UNSUPPORTED",
    "CODEX_APP_SERVER_REQUEST_TIMEOUT",
    "CODEX_APP_SERVER_THREAD_START_FAILED",
    "CODEX_APP_SERVER_THREAD_ID_MISSING",
    "CODEX_APP_SERVER_TURN_START_FAILED",
    "CODEX_APP_SERVER_TURN_ID_MISSING",
    "CODEX_APP_SERVER_TURN_FAILED",
    "CODEX_APP_SERVER_TURN_TIMEOUT",
    "CODEX_APP_SERVER_FINAL_INVALID",
    "CODEX_APP_SERVER_TOOL_CALL_UNKNOWN",
    "CODEX_APP_SERVER_PROTOCOL_CONTAMINATION",
    "CODEX_NATIVE_SESSION_TIMEOUT",
    "CODEX_NATIVE_SESSION_ENDED_WITHOUT_FINAL",
    "CODEX_NATIVE_FINAL_MISSING",
    "CODEX_NATIVE_PROCESS_FAILED",
    "CODEX_AUTH_REQUIRED",
  ].includes(errorCode(error));
}

function errorPayload(error) {
  const code = errorCode(error);
  if (runtimeFailure(error)) {
    const message = {
      CODEX_AUTH_REQUIRED: LUNA_AUTH_REQUIRED_MESSAGE,
    }[code] || (code.startsWith("CODEX_APP_SERVER_") ? LUNA_APP_SERVER_RUNTIME_MESSAGE : LUNA_RUNTIME_ERROR_MESSAGE);
    return { status: 503, payload: { ok: false, terminalState: "LUNA_RUNTIME_UNAVAILABLE", message } };
  }
  return { status: 500, payload: { ok: false, terminalState: "NETWORK_SERVER_ERROR", message: "검색 처리 중 오류가 발생했습니다." } };
}

function codexApiErrorPayload(error) {
  const code = errorCode(error);
  if (code === "CODEX_LOGIN_TYPE_UNSUPPORTED") {
    return { status: 400, payload: { ok: false, code, message: "지원하지 않는 Codex 로그인 방식입니다." } };
  }
  if (code === "CODEX_AUTH_REQUIRED") {
    return { status: 503, payload: { ok: false, code, message: LUNA_AUTH_REQUIRED_MESSAGE } };
  }
  if (String(code).startsWith("CODEX_")) {
    return { status: 503, payload: { ok: false, code, message: LUNA_APP_SERVER_RUNTIME_MESSAGE } };
  }
  return { status: 500, payload: { ok: false, code: "CODEX_API_FAILED", message: "Codex 상태를 확인하지 못했습니다." } };
}

function sendCodexApiError(response, error) {
  if (Number.isInteger(error?.status)) {
    sendJson(response, error.status, { ok: false, code: error.code || "CODEX_API_REQUEST_INVALID", message: error.message });
    return;
  }
  const failure = codexApiErrorPayload(error);
  sendJson(response, failure.status, failure.payload);
}

function requestLocalPort(request) {
  return Number(request.socket?.localPort || config.port);
}

function adminValidationMessage(error) {
  const message = String(error?.message || "");
  const field = message.match(/^ADMIN_(?:SETTING_INVALID|SECRET_EMPTY):([A-Z][A-Z0-9_]*)$/u)?.[1];
  return field ? `ADMIN_SETTING_INVALID:${field}` : "ADMIN_SETTINGS_INVALID";
}

export function isTrustedLocalHost(request) {
  const host = request.headers.host;
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    const hostname = parsed.hostname.toLowerCase();
    if (!new Set(["127.0.0.1", "localhost"]).has(hostname)) return false;
    return Number(parsed.port || 80) === requestLocalPort(request);
  } catch {
    return false;
  }
}

export function sameOrigin(request) {
  if (!isTrustedLocalHost(request)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.protocol === "http:"
      && new Set(["127.0.0.1", "localhost"]).has(hostname)
      && Number(parsed.port || 80) === requestLocalPort(request);
  } catch {
    return false;
  }
}

async function serveAsset(urlPath, response) {
  const asset = PUBLIC_ASSETS[urlPath];
  if (!asset) return false;
  const [fileName, contentType] = asset;
  const body = await fs.readFile(path.join(publicRoot, fileName));
  response.writeHead(200, { "content-type": contentType, "content-length": body.length });
  response.end(body);
  return true;
}

async function handleAsk(request, response, stream = false, executeQueryImpl = executeQuery) {
  const body = await parseJsonBody(request);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    sendJson(response, 400, { ok: false, terminalState: "SEARCH_FAILED", message: "질문을 입력해 주세요." });
    return;
  }

  if (stream) {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    response.flushHeaders?.();
  }

  const abortController = new AbortController();
  const abortRequest = () => {
    if (!response.writableFinished) abortController.abort();
  };
  request.once("aborted", abortRequest);
  response.once("close", abortRequest);
  try {
    const result = await executeQueryImpl(query, (event) => {
      if (stream) sendSse(response, event.event, event);
    }, { abortSignal: abortController.signal });
    if (stream) {
      sendSse(response, "FINAL", result.payload);
      response.end();
    } else {
      sendJson(response, result.status, result.payload);
    }
  } catch (error) {
    if (error?.code === "ABORTED" || request.aborted || response.destroyed) return;
    const failure = errorPayload(error);
    await logError(runtimeFailure(error) ? "Luna Native runtime failure" : "HTTP 요청 처리 실패", error);
    if (stream) {
      sendSse(response, "SEARCH_FAILED", failure.payload);
      response.end();
    } else {
      sendJson(response, failure.status, failure.payload);
    }
  } finally {
    request.removeListener("aborted", abortRequest);
    response.removeListener("close", abortRequest);
  }
}

export function createRequestHandler({
  executeQueryImpl = executeQuery,
  healthPayloadImpl = healthPayload,
  adminSettingsViewImpl = adminSettingsView,
  validateAdminPatchImpl = validateAdminPatch,
  writeAdminSettingsImpl = writeAdminSettings,
  codexRuntimeImpl = getDefaultCodexAppServerRuntime,
  codexAccountManagerImpl = getDefaultCodexAccountManager,
} = {}) {
  return (request, response) => {
    void (async () => {
      if (!isTrustedLocalHost(request)) {
        sendJson(response, 403, { ok: false, message: "Untrusted local Host header." });
        return;
      }
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (request.method === "GET" && (await serveAsset(url.pathname, response))) return;
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, await healthPayloadImpl());
        return;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        sendJson(response, 200, await healthPayloadImpl());
        return;
      }
      if (request.method === "GET" && url.pathname === "/admin/config") {
        sendJson(response, 200, { ok: true, ...adminSettingsViewImpl() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/codex/usage") {
        try {
          sendJson(response, 200, { ok: true, ...(await codexRuntimeImpl().usageSnapshot()) });
        } catch (error) {
          sendCodexApiError(response, error);
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/codex/account") {
        try {
          sendJson(response, 200, { ok: true, ...codexAccountApiView(await codexAccountManagerImpl().read()) });
        } catch (error) {
          sendCodexApiError(response, error);
        }
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/codex/rate-limits") {
        try {
          const limits = await codexAccountManagerImpl().readRateLimits();
          sendJson(response, 200, { ok: true, source: "app_server", codexQuota: codexQuotaApiView(limits?.codexQuota) });
        } catch (error) {
          sendCodexApiError(response, error);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/codex/login/start") {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, message: "Codex 로그인은 같은 출처에서만 시작할 수 있습니다." });
          return;
        }
        try {
          const body = await parseJsonBody(request);
          const result = await codexAccountManagerImpl().startLogin(body?.type || "chatgpt");
          sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          sendCodexApiError(response, error);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/codex/login/cancel") {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, message: "Codex 로그인 취소는 같은 출처에서만 요청할 수 있습니다." });
          return;
        }
        try {
          const body = await parseJsonBody(request);
          const result = await codexAccountManagerImpl().cancelLogin(body?.loginId || "");
          sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          sendCodexApiError(response, error);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/codex/logout") {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, message: "Codex 로그아웃은 같은 출처에서만 요청할 수 있습니다." });
          return;
        }
        try {
          sendJson(response, 200, { ok: true, ...(await codexAccountManagerImpl().logout()) });
        } catch (error) {
          sendCodexApiError(response, error);
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/admin/config") {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, message: "관리자 설정은 같은 출처에서만 저장할 수 있습니다." });
          return;
        }
        let patch;
        try {
          patch = validateAdminPatchImpl(await parseJsonBody(request));
        } catch (error) {
          if (error?.code === MALFORMED_JSON || error?.code === REQUEST_BODY_TOO_LARGE) throw error;
          sendJson(response, 400, { ok: false, message: adminValidationMessage(error) });
          return;
        }
        const writtenFields = await writeAdminSettingsImpl(patch);
        sendJson(response, 200, {
          ok: true,
          writtenFields,
          restartRequired: true,
          message: "설정이 저장되었습니다. 서버 재시작 후 적용됩니다.",
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/ask") {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, message: "Untrusted local Origin header." });
          return;
        }
        await handleAsk(request, response, false, executeQueryImpl);
        return;
      }
      if (request.method === "POST" && url.pathname === "/ask/stream") {
        if (!sameOrigin(request)) {
          sendJson(response, 403, { ok: false, message: "Untrusted local Origin header." });
          return;
        }
        await handleAsk(request, response, true, executeQueryImpl);
        return;
      }
      sendJson(response, 404, { ok: false, message: "Not Found" });
    })().catch(async (error) => {
      if (!response.headersSent && Number.isInteger(error?.status)) {
        sendJson(response, error.status, {
          ok: false,
          terminalState: "SEARCH_FAILED",
          message: error.message,
        });
        return;
      }
      await logError("HTTP 요청 처리 실패", error);
      if (!response.headersSent) sendJson(response, 500, { ok: false, terminalState: "NETWORK_SERVER_ERROR", message: "검색 처리 중 오류가 발생했습니다." });
    });
  };
}
