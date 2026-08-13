import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { LEGAL_TOOL_NAMES, createLegalToolGateway } from "../legalToolGateway.js";
import { createEvidenceLedger } from "../evidenceLedger.js";
import { createSafetyController } from "../safety.js";
import { createTelemetry } from "../telemetry.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const upstreamEntry = path.join(rootDir, "node_modules", "korean-law-mcp", "build", "index.js");
const dotenvResult = loadDotenv({ path: path.join(rootDir, ".env"), processEnv: {}, quiet: true });
if (!process.env.LAW_OC && dotenvResult.parsed?.LAW_OC) process.env.LAW_OC = dotenvResult.parsed.LAW_OC;

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
  env: { ...process.env },
});
await upstream.connect(upstreamTransport);
const upstreamTools = (await upstream.listTools()).tools || [];
const missingTools = [...allowedTools].filter((name) => !upstreamTools.some((tool) => tool.name === name));
if (missingTools.length) throw new Error(`RESTRICTED_MCP_TOOL_MISSING:${missingTools.join(",")}`);
const toolDefinitions = upstreamTools.filter((tool) => allowedTools.has(tool.name));
const logPath = process.env.LEGAL_MCP_LOG_PATH || "";
let latestRawResult = null;

async function diagnostic(value) {
  if (!logPath) return;
  await fs.appendFile(logPath, `${JSON.stringify(value)}\n`).catch(() => {});
}

const gateway = createLegalToolGateway({
  ledger,
  telemetry,
  safety,
  callTool: async (name, args) => {
    latestRawResult = await upstream.callTool({ name, arguments: args });
    return latestRawResult;
  },
});
const server = new Server(
  { name: "case-finder-restricted-legal-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  if (!allowedTools.has(name)) throw new Error(`RESTRICTED_MCP_TOOL_DENIED:${name}`);
  const args = request.params.arguments || {};
  latestRawResult = null;
  const result = await gateway.execute(name, args);
  await diagnostic({ event: "tool", name, trace: gateway.snapshotTrace().at(-1) || null });
  return latestRawResult || { isError: Boolean(result?.isError), content: [{ type: "text", text: JSON.stringify(result) }] };
});

await server.connect(new StdioServerTransport());
await diagnostic({ event: "ready", scope_id: ledger.scopeId, tools: [...allowedTools] });
