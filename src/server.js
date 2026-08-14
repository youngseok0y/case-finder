import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { config, EXPECTED_NODE_VERSION, ROOT_DIR } from "../config.js";
import { readGeminiUsage } from "./rateLimiter.js";
import { closeMcp, getMcpStatus, startMcp } from "./mcpClient.js";
import { lookupDirect } from "./directLookup.js";
import { logError, logInfo } from "./log.js";
import { renderResults } from "./renderer.js";
import { routeQuery } from "./router.js";
import { createProgressReporter } from "./progress.js";
import { defaultSearchAdapterRegistry } from "./searchAdapters/registry.js";
import { toResultContract } from "./searchAdapters/resultContract.js";
import { validateDirectResult, validateNaturalResult } from "./validator.js";
import { getCodexRuntimeStatus } from "./codexResolver.js";
import { adminSettingsView, validateAdminPatch, writeAdminSettings } from "./adminConfig.js";
import {
  LUNA_AUTH_REQUIRED_MESSAGE,
  LUNA_HOST_REQUIRED_MESSAGE,
  LUNA_INSTALL_REQUIRED_MESSAGE,
  LUNA_RUNTIME_ERROR_MESSAGE,
  LUNA_VERSION_CHECK_MESSAGE,
  PRODUCT_SERVICE,
} from "./productMessages.js";

const publicRoot = path.join(ROOT_DIR, "public");
const maxBodyBytes = 10_000;
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
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("요청 본문은 10,000바이트를 넘을 수 없습니다.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function adapterLabel(adapter) {
  return adapter === "gemini_d" ? "Gemini 빠른 검색" : "Luna 고정밀 검색";
}

async function quotaStatus() {
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
  return {
    gemini,
    luna: { label: "Luna 사용량 확인 불가", source: "unavailable" },
  };
}

async function healthPayload() {
  const luna = config.searchAdapter === "luna_native"
    ? getCodexRuntimeStatus()
    : { configured: false, codexAvailable: false, codeModeHostAvailable: false, version: "" };
  return {
    service: PRODUCT_SERVICE,
    ok: true,
    node: process.version,
    expectedNode: EXPECTED_NODE_VERSION,
    adapter: { id: config.searchAdapter, label: adapterLabel(config.searchAdapter) },
    mcp: getMcpStatus(),
    luna,
    quota: await quotaStatus(),
  };
}

function verifiedCount(result) {
  return (result?.items || []).filter((item) => item.status === "verified").length;
}

function lawCount(result) {
  return Array.isArray(result?.lawReferences) ? result.lawReferences.length : 0;
}

function candidateCount(result) {
  return Array.isArray(result?.candidateCaseNumbers) ? result.candidateCaseNumbers.length : 0;
}

function responseForResult({ query, route, result, stage }) {
  if (stage === "DIRECT") {
    return {
      ok: true,
      service: PRODUCT_SERVICE,
      stage: "DIRECT",
      route,
      query,
      html: renderResults(result),
      result,
    };
  }
  return {
    ok: true,
    service: PRODUCT_SERVICE,
    stage,
    route,
    query,
    html: renderResults(result),
    result,
  };
}

async function executeQuery(query, onProgress = () => {}) {
  const progress = createProgressReporter(onProgress);
  progress.emit("SEARCH_STARTED");
  const route = routeQuery(query, config.caseNumberMax);
  progress.emit("ROUTE_IDENTIFIED", { route: route.kind });

  if (route.kind === "direct") {
    const lookedUp = await lookupDirect(query, route);
    const validated = await validateDirectResult(lookedUp);
    progress.emit("DETAIL_VERIFIED", {
      route: "direct",
      candidateCount: validated.items?.length || 0,
      verifiedCount: verifiedCount(validated),
      lawCount: lawCount(validated),
    });
    progress.emit("FINALIZING", { route: "direct", verifiedCount: verifiedCount(validated) });
    const response = responseForResult({ query, route: "direct", result: validated, stage: "DIRECT" });
    progress.emit("SEARCH_COMPLETE", { route: "direct", verifiedCount: verifiedCount(validated), lawCount: lawCount(validated) });
    return { status: 200, payload: response };
  }

  const adapter = defaultSearchAdapterRegistry.resolve(config.searchAdapter);
  const adapterResult = await adapter.runNaturalQuery(query, {
    onProgress: (event, details) => progress.emit(event, { ...details, route: "natural" }),
  });
  const validated = await validateNaturalResult(adapterResult);
  const publicResult = toResultContract(validated);
  const response = responseForResult({
    query,
    route: "natural",
    result: publicResult,
    stage: config.searchAdapter === "luna_native" ? "LUNA_NATIVE" : "GEMINI_D",
  });
  progress.emit("SEARCH_COMPLETE", {
    route: "natural",
    candidateCount: candidateCount(publicResult),
    verifiedCount: verifiedCount(publicResult),
    lawCount: lawCount(publicResult),
  });
  return { status: 200, payload: response };
}

function errorCode(error) {
  return error?.code || String(error?.message || "").split(":", 1)[0];
}

function runtimeFailure(error) {
  return config.searchAdapter === "luna_native" && [
    "CODEX_CLI_UNAVAILABLE",
    "CODEX_HOST_UNAVAILABLE",
    "CODEX_VERSION_CHECK_FAILED",
    "CODEX_SPAWN_FAILED",
    "CODEX_NATIVE_SESSION_TIMEOUT",
    "CODEX_NATIVE_SESSION_ENDED_WITHOUT_FINAL",
    "CODEX_NATIVE_FINAL_MISSING",
    "CODEX_NATIVE_PROCESS_FAILED",
    "CODEX_AUTH_REQUIRED",
    "ENOENT",
    "EACCES",
    "EPERM",
  ].includes(errorCode(error));
}

function errorPayload(error) {
  const code = errorCode(error);
  if (runtimeFailure(error)) {
    const message = {
      CODEX_AUTH_REQUIRED: LUNA_AUTH_REQUIRED_MESSAGE,
      CODEX_CLI_UNAVAILABLE: LUNA_INSTALL_REQUIRED_MESSAGE,
      CODEX_HOST_UNAVAILABLE: LUNA_HOST_REQUIRED_MESSAGE,
      CODEX_VERSION_CHECK_FAILED: LUNA_VERSION_CHECK_MESSAGE,
    }[code] || LUNA_RUNTIME_ERROR_MESSAGE;
    return { status: 503, payload: { ok: false, terminalState: "LUNA_RUNTIME_UNAVAILABLE", message } };
  }
  return { status: 500, payload: { ok: false, terminalState: "NETWORK_SERVER_ERROR", message: "검색 처리 중 오류가 발생했습니다." } };
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const expected = new URL(`http://${request.headers.host || "127.0.0.1"}`).origin;
    return new URL(origin).origin === expected;
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

async function handleAsk(request, response, stream = false) {
  const body = JSON.parse(await readBody(request));
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

  try {
    const result = await executeQuery(query, (event) => {
      if (stream) sendSse(response, event.event, event);
    });
    if (stream) {
      sendSse(response, "FINAL", result.payload);
      response.end();
    } else {
      sendJson(response, result.status, result.payload);
    }
  } catch (error) {
    const failure = errorPayload(error);
    await logError(runtimeFailure(error) ? "Luna Native runtime failure" : "HTTP 요청 처리 실패", error);
    if (stream) {
      sendSse(response, "SEARCH_FAILED", failure.payload);
      response.end();
    } else {
      sendJson(response, failure.status, failure.payload);
    }
  }
}

const server = http.createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && (await serveAsset(url.pathname, response))) return;
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, await healthPayload());
      return;
    }
    if (request.method === "GET" && url.pathname === "/status") {
      sendJson(response, 200, await healthPayload());
      return;
    }
    if (request.method === "GET" && url.pathname === "/admin/config") {
      sendJson(response, 200, { ok: true, ...adminSettingsView() });
      return;
    }
    if (request.method === "POST" && url.pathname === "/admin/config") {
      if (!sameOrigin(request)) {
        sendJson(response, 403, { ok: false, message: "관리자 설정은 같은 출처에서만 저장할 수 있습니다." });
        return;
      }
      const patch = validateAdminPatch(JSON.parse(await readBody(request)));
      const writtenFields = await writeAdminSettings(patch);
      sendJson(response, 200, {
        ok: true,
        writtenFields,
        restartRequired: true,
        message: "설정이 저장되었습니다. 서버 재시작 후 적용됩니다.",
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/ask") {
      await handleAsk(request, response, false);
      return;
    }
    if (request.method === "POST" && url.pathname === "/ask/stream") {
      await handleAsk(request, response, true);
      return;
    }
    sendJson(response, 404, { ok: false, message: "Not Found" });
  })().catch(async (error) => {
    await logError("HTTP 요청 처리 실패", error);
    if (!response.headersSent) sendJson(response, 500, { ok: false, terminalState: "NETWORK_SERVER_ERROR", message: "검색 처리 중 오류가 발생했습니다." });
  });
});

server.on("error", (error) => {
  void logError("HTTP 서버 오류", error);
});

process.on("SIGINT", () => {
  server.close(async () => {
    await closeMcp();
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  server.close(async () => {
    await closeMcp();
    process.exit(0);
  });
});

try {
  await startMcp({ probe: true });
} catch (error) {
  await logError("MCP 서버 기동 실패", error);
}

server.listen(config.port, "127.0.0.1", () => {
  logInfo(`http://localhost:${config.port} 에서 실행 중입니다.`);
});

export { executeQuery, healthPayload };
