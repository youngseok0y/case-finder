import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = path.dirname(currentFile);
const configuredSearchDisplay = Number.parseInt(process.env.SEARCH_DISPLAY || "20", 10);

export const ROOT_DIR = rootDir;
export const EXPECTED_NODE_VERSION = ">=24.14.0 <25";

export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT || "3300", 10),
  lawOc: process.env.LAW_OC || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: "gemini-3.5-flash-lite",
  pipelineMode: process.env.PIPELINE_MODE || "deterministic",
  mcpTimeoutMs: 30_000,
  mcpProbeQuery: "민법",
  geminiRpmLimit: 13,
  geminiRpdLimit: 450,
  geminiRetryDelayMs: 20_000,
  agenticCallMax: Number.parseInt(process.env.AGENTIC_CALL_MAX || "6", 10),
  searchConcurrency: 5,
  searchDisplay: Number.isInteger(configuredSearchDisplay)
    ? Math.min(100, Math.max(1, configuredSearchDisplay))
    : 20,
  lawSearchDisplay: 5,
  candidateMax: 20,
  previewMissingPenalty: 2,
  caseNumberMax: 5,
  detailMax: 2,
  lawMax: 4,
  resultMax: 5,
  mcpBinPath: path.join(rootDir, "node_modules", ".bin", "korean-law-mcp"),
});
