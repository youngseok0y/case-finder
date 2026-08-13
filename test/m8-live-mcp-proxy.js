import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_ENTRY = path.join(ROOT_DIR, "node_modules", "korean-law-mcp", "build", "index.js");
loadDotenv({ path: path.join(ROOT_DIR, ".env"), quiet: true });
loadDotenv({ path: path.resolve(ROOT_DIR, "..", "..", ".env"), quiet: true });
const { createLegalToolGateway } = await import("../src/aoV2/legalToolGateway.js");
const { createEvidenceLedger } = await import("../src/aoV2/evidenceLedger.js");
const { createSafetyController } = await import("../src/aoV2/safety.js");
const { createTelemetry } = await import("../src/aoV2/telemetry.js");

const ALLOWED_TOOLS = new Set([
  "search_decisions",
  "get_decision_text",
  "search_law",
  "get_law_text",
]);
const logPath = process.env.M8_PROXY_LOG_PATH || "";
const ledger = createEvidenceLedger({ provider: "codex_luna_proxy" });
const telemetry = createTelemetry({ provider: "codex_luna_proxy", questionScopeId: ledger.scopeId });
const safety = createSafetyController({ wallClockMaxMs: 600_000, legalToolMax: 100 });
const upstreamTransport = new StdioClientTransport({
  command: process.execPath,
  args: [UPSTREAM_ENTRY],
  env: { ...process.env },
});
const upstream = new Client(
  { name: "m8-provider-native-proxy-client", version: "0.1.0" },
  { capabilities: {} },
);
await upstream.connect(upstreamTransport);
const upstreamTools = (await upstream.listTools()).tools || [];
const missingTools = [...ALLOWED_TOOLS].filter((name) => !upstreamTools.some((tool) => tool.name === name));
if (missingTools.length) throw new Error(`M8_RESTRICTED_MCP_TOOL_MISSING:${missingTools.join(",")}`);
const restrictedToolDefinitions = upstreamTools.filter((tool) => ALLOWED_TOOLS.has(tool.name));
let latestRawResult = null;
const gateway = createLegalToolGateway({
  ledger,
  telemetry,
  safety,
  callTool: async (name, args) => {
    latestRawResult = await upstream.callTool({ name, arguments: args });
    return latestRawResult;
  },
});

async function diagnostic(value) {
  if (!logPath) return;
  await fs.appendFile(logPath, `${JSON.stringify(value)}\n`).catch(() => {});
}

const server = new Server(
  { name: "m8-provider-native-korean-law-proxy", version: "0.1.0" },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: restrictedToolDefinitions }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  if (!ALLOWED_TOOLS.has(name)) throw new Error(`M8_RESTRICTED_MCP_TOOL_DENIED:${name}`);
  const args = request.params.arguments || {};
  latestRawResult = null;
  const result = await gateway.execute(name, args);
  await diagnostic({ event: "tool", name, args, result, trace: gateway.snapshotTrace().at(-1) || null });
  return latestRawResult || { isError: Boolean(result?.isError), content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: null };
});

const transport = new StdioServerTransport();
await server.connect(transport);
await diagnostic({ event: "ready", scope_id: ledger.scopeId, tools: [...ALLOWED_TOOLS] });

async function close() {
  await diagnostic({ event: "close", ledger: ledger.snapshot(), telemetry: telemetry.snapshot(ledger), trace: gateway.snapshotTrace() });
  await transport.close().catch(() => {});
  await upstreamTransport.close().catch(() => {});
}
process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
