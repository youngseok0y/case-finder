import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { config, EXPECTED_NODE_VERSION, ROOT_DIR } from "../config.js";
import { closeMcp, getMcpStatus, startMcp } from "./mcpClient.js";
import { lookupDirect } from "./directLookup.js";
import { logError, logInfo } from "./log.js";
import { renderResults } from "./renderer.js";
import { routeQuery } from "./router.js";
import { defaultSearchAdapterRegistry } from "./searchAdapters/registry.js";
import { toResultContract } from "./searchAdapters/resultContract.js";
import { validateDirectResult, validateNaturalResult } from "./validator.js";
import { PRODUCT_SERVICE } from "./productMessages.js";

const indexPath = path.join(ROOT_DIR, "public", "index.html");
const maxBodyBytes = 10_000;

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
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

async function handle(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    const html = await fs.readFile(indexPath, "utf8");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      service: "case-finder",
      ok: true,
      node: process.version,
      expectedNode: EXPECTED_NODE_VERSION,
      mcp: getMcpStatus(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/ask") {
    const body = JSON.parse(await readBody(request));
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      sendJson(response, 400, { ok: false, message: "질문을 입력해 주세요." });
      return;
    }
    const route = routeQuery(query, config.caseNumberMax);
    if (route.kind === "direct") {
      const lookedUp = await lookupDirect(query, route);
      const validated = await validateDirectResult(lookedUp);
      sendJson(response, 200, {
        ok: true,
        service: PRODUCT_SERVICE,
        stage: "DIRECT",
        route: "direct",
        html: renderResults(validated),
        result: validated,
      });
      return;
    }
    const adapter = defaultSearchAdapterRegistry.resolve(config.searchAdapter);
    const adapterResult = await adapter.runNaturalQuery(query);
    const validated = await validateNaturalResult(adapterResult);
    const publicResult = toResultContract(validated);
    sendJson(response, 200, {
      ok: true,
      service: PRODUCT_SERVICE,
      stage: config.searchAdapter === "luna_native" ? "LUNA_NATIVE" : "GEMINI_D",
      route: "natural",
      query,
      html: renderResults(validated),
      result: publicResult,
    });
    return;
  }

  sendJson(response, 404, { ok: false, message: "Not Found" });
}

const server = http.createServer((request, response) => {
  void handle(request, response).catch(async (error) => {
    await logError("HTTP 요청 처리 실패", error);
    if (!response.headersSent) {
      sendJson(response, 500, { ok: false, message: "검색 처리 중 오류가 발생했습니다." });
    }
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
