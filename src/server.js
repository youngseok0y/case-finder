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

function closeHttpServer(server, graceMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, graceMs);
    try {
      server.close(finish);
      server.closeIdleConnections?.();
    } catch {
      finish();
    }
  });
}

export function createGracefulShutdown({
  server: targetServer,
  closeAccountManager = closeDefaultCodexAccountManager,
  closeRuntime = closeDefaultCodexAppServerRuntime,
  closeLegalMcp = closeMcp,
  graceMs = 10_000,
} = {}) {
  const gracePeriod = Math.max(0, Number(graceMs) || 0);
  let shutdownPromise = null;
  return () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      await closeHttpServer(targetServer, gracePeriod);
      for (const closeResource of [closeAccountManager, closeRuntime, closeLegalMcp]) {
        try {
          await closeResource();
        } catch (error) {
          await logError("종료 중 리소스 정리 실패", error);
        }
      }
    })();
    return shutdownPromise;
  };
}

if (isMainModule) {
  const shutdown = createGracefulShutdown({ server });
  let exitRequested = false;
  const handleSignal = () => {
    if (exitRequested) return;
    exitRequested = true;
    void shutdown().then(() => process.exit(0)).catch(async (error) => {
      await logError("종료 처리 실패", error);
      process.exit(1);
    });
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

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
