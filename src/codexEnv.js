import { buildRuntimeEnv } from "./runtimeEnv.js";

export function buildCodexChildEnv(source = process.env, { legalMcpLogPath = "", codexHomePath = "" } = {}) {
  return buildRuntimeEnv(source, {
    ...(codexHomePath ? { CODEX_HOME: codexHomePath } : {}),
    ...(legalMcpLogPath ? { LEGAL_MCP_LOG_PATH: legalMcpLogPath } : {}),
  });
}
