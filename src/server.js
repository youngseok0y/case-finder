import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { closeMcp, startMcp } from "./mcpClient.js";
import { logError, logInfo } from "./log.js";
import { closeDefaultCodexAppServerRuntime } from "./codexAppServerRuntime.js";
import { closeDefaultCodexAccountManager } from "./codexAccount.js";
import {
  createRequestHandler,
  healthPayload,
  isTrustedLocalHost,
  sameOrigin,
} from "./httpApi.js";
import { executeQuery } from "./queryExecution.js";

const server = http.createServer(createRequestHandler());

server.on("error", (error) => {
  void logError("HTTP 서버 오류", error);
});

const isMainModule = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  process.on("SIGINT", () => {
    server.close(async () => {
      closeDefaultCodexAccountManager();
      await closeDefaultCodexAppServerRuntime();
      await closeMcp();
      process.exit(0);
    });
  });

  process.on("SIGTERM", () => {
    server.close(async () => {
      closeDefaultCodexAccountManager();
      await closeDefaultCodexAppServerRuntime();
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
}

export {
  createRequestHandler,
  executeQuery,
  healthPayload,
  isTrustedLocalHost,
  sameOrigin,
};
