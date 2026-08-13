import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.CASE_FINDER_SKIP_DOTENV !== "1") loadDotenv({ quiet: true });

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.dirname(currentFile);
const configuredSearchDisplay = Number.parseInt(process.env.SEARCH_DISPLAY || "20", 10);
const configuredSearchAdapter = process.env.SEARCH_ADAPTER || "gemini_d";
if (!new Set(["gemini_d", "luna_native"]).has(configuredSearchAdapter)) {
  throw new Error(`PRODUCT_ADAPTER_UNSUPPORTED:${configuredSearchAdapter}`);
}

export const ROOT_DIR = rootDir;
export const EXPECTED_NODE_VERSION = ">=24.14.0 <25";

export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT || "3300", 10),
  lawOc: process.env.LAW_OC || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: "gemini-3.5-flash-lite",
  searchAdapter: configuredSearchAdapter,
  mcpTimeoutMs: 30_000,
  mcpProbeQuery: "민법",
  geminiRpmLimit: 13,
  geminiRpmWaitMarginMs: 350,
  geminiRpdLimit: 450,
  geminiRetryDelayMs: 20_000,
  codexModel: "gpt-5.6-luna",
  codexReasoningEffort: "medium",
  codexCliPath: process.env.CODEX_CLI_PATH || "codex",
  codexWorkdir: path.resolve(rootDir, process.env.CODEX_WORKDIR || path.join("state", "codex-runtime")),
  codexTimeoutMs: Math.max(30_000, Number.parseInt(process.env.CODEX_TIMEOUT_MS || "120000", 10)),
  searchConcurrency: 5,
  searchDisplay: Number.isInteger(configuredSearchDisplay)
    ? Math.min(100, Math.max(1, configuredSearchDisplay))
    : 20,
  lawSearchDisplay: 5,
  candidateMax: 20,
  previewMissingPenalty: 2,
  caseNumberMax: 5,
  lawMax: 4,
  resultMax: 5,
  mcpBinPath: path.join(rootDir, "node_modules", ".bin", "korean-law-mcp"),
});
