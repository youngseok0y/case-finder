import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config, ROOT_DIR } from "../config.js";
import { logError, logInfo } from "./log.js";

let client = null;
let transport = null;
let startPromise = null;
let lastToolNames = [];

function serverParameters() {
  const binPath = process.platform === "win32" ? `${config.mcpBinPath}.cmd` : config.mcpBinPath;
  if (!fs.existsSync(binPath)) {
    throw new Error(`korean-law-mcp 실행 파일이 없습니다: ${path.relative(ROOT_DIR, binPath)}`);
  }

  const env = { ...process.env, LAW_OC: config.lawOc };
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", binPath],
      env,
    };
  }
  return { command: binPath, args: [], env };
}

function timeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`MCP 호출 시간 초과(${timeoutMs}ms)`)), timeoutMs);
    }),
  ]);
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
  const params = serverParameters();
  const nextTransport = new StdioClientTransport(params);
  const nextClient = new Client(
    { name: "fable-case-finder", version: "0.1.0" },
    { capabilities: {} },
  );

  nextTransport.onerror = (error) => {
    void logError("korean-law-mcp 프로세스 오류", error);
  };
  nextTransport.onclose = () => {
    if (transport === nextTransport) {
      client = null;
      transport = null;
    }
    logInfo("korean-law-mcp 연결이 종료됐습니다.");
  };

  await nextClient.connect(nextTransport);
  const listed = await nextClient.listTools();
  lastToolNames = (listed.tools || []).map((tool) => tool.name);
  client = nextClient;
  transport = nextTransport;
  logInfo(`korean-law-mcp 연결 완료 (${lastToolNames.length}개 도구)`);
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
      throw new Error("M0 MCP 검색 확인 실패");
    }
    logInfo(`M0 MCP 검색 성공: search_law(\"${config.mcpProbeQuery}\")`);
  } else if (probe) {
    logInfo("M0 MCP 검색 확인을 건너뛰었습니다: LAW_OC가 설정되지 않았습니다.");
  }
}

export async function callTool(name, args = {}, timeoutMs = config.mcpTimeoutMs) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await startMcp();
      return await timeout(client.callTool({ name, arguments: args }), timeoutMs);
    } catch (error) {
      const staleTransport = transport;
      client = null;
      transport = null;
      await closeStaleTransport(staleTransport, (closeError) => {
        void logError("오래된 korean-law-mcp 연결 정리 실패", closeError);
      });
      if (attempt === 1) throw error;
      await logError(`MCP 호출 실패 후 재기동합니다: ${name}`, error);
    }
  }
  throw new Error("MCP 호출 실패");
}

export function getMcpStatus() {
  return {
    connected: Boolean(client),
    tools: [...lastToolNames],
  };
}

export async function closeMcp() {
  const staleTransport = transport;
  client = null;
  transport = null;
  await closeStaleTransport(staleTransport, (error) => {
    void logError("korean-law-mcp 연결 종료 실패", error);
  });
}
