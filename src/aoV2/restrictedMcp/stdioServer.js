import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { buildLegalMcpEnv, buildRuntimeEnv } from "../../runtimeEnv.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const upstreamEntry = path.join(rootDir, "node_modules", "korean-law-mcp", "build", "index.js");
const dotenvResult = loadDotenv({ path: path.join(rootDir, ".env"), processEnv: {}, quiet: true });
const bridgeEnv = buildRuntimeEnv(process.env, {
  CASE_FINDER_SKIP_DOTENV: "1",
  ...(dotenvResult.parsed?.LAW_OC ? { LAW_OC: dotenvResult.parsed.LAW_OC } : {}),
  ...(process.env.LEGAL_MCP_LOG_PATH ? { LEGAL_MCP_LOG_PATH: process.env.LEGAL_MCP_LOG_PATH } : {}),
});
for (const key of Object.keys(process.env)) {
  if (!Object.prototype.hasOwnProperty.call(bridgeEnv, key)) delete process.env[key];
}
Object.assign(process.env, bridgeEnv);

const { LEGAL_TOOL_NAMES, createLegalToolGateway } = await import("../legalToolGateway.js");
const { createEvidenceLedger } = await import("../evidenceLedger.js");
const { createSafetyController } = await import("../safety.js");
const { createTelemetry } = await import("../telemetry.js");
const { createRestrictedToolHandler } = await import("./requestHandler.js");

const allowedTools = new Set(LEGAL_TOOL_NAMES);
const ledger = createEvidenceLedger({ provider: "codex_luna_stdio" });
const telemetry = createTelemetry({ provider: "codex_luna_stdio", questionScopeId: ledger.scopeId });
const safety = createSafetyController();
const upstream = new Client(
  { name: "case-finder-legal-bridge", version: "0.1.0" },
  { capabilities: {} },
);
const upstreamTransport = new StdioClientTransport({
  command: process.execPath,
  args: [upstreamEntry],
  env: buildLegalMcpEnv(process.env, process.env.LAW_OC),
});
await upstream.connect(upstreamTransport);
const upstreamTools = (await upstream.listTools()).tools || [];
const missingTools = [...allowedTools].filter((name) => !upstreamTools.some((tool) => tool.name === name));
if (missingTools.length) throw new Error(`RESTRICTED_MCP_TOOL_MISSING:${missingTools.join(",")}`);
const toolDefinitions = upstreamTools.filter((tool) => allowedTools.has(tool.name));
const logPath = process.env.LEGAL_MCP_LOG_PATH || "";

async function diagnostic(value) {
  if (!logPath) return;
  await fs.appendFile(logPath, `${JSON.stringify(value)}\n`).catch(() => {});
}

const handleTool = createRestrictedToolHandler({
  allowedTools,
  upstream,
  ledger,
  telemetry,
  safety,
  diagnostic,
  createGateway: createLegalToolGateway,
});
const server = new Server(
  { name: "case-finder-restricted-legal-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return handleTool({ name: request.params.name, args: request.params.arguments || {} });
});

await server.connect(new StdioServerTransport());
await diagnostic({ event: "ready", scope_id: ledger.scopeId, tools: [...allowedTools] });
