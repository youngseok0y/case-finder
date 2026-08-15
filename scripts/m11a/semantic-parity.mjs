import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config as loadDotenv } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER = path.join(ROOT, "scripts", "m11a", "mcp-server-wrapper.mjs");
const DECISION_QUERY = "99두2963";
const LAW_QUERY = "민법";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function textOf(result) {
  return result?.content?.find((item) => item.type === "text")?.text || "";
}

function decisionIdOf(text) {
  const patterns = [
    /(?:\b(?:precSeq|decisionId|caseId|id|ID)\b|일련번호|판례ID|판례일련번호)\s*[:：=]\s*["']?(\d+)/iu,
    /precInfoP\.do\?precSeq=(\d+)/iu,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function lawMstOf(text) {
  return text.match(/\bMST\s*[:：]\s*(\d+)/iu)?.[1] || "";
}

function validDetail(result) {
  const text = textOf(result);
  return Boolean(!result?.isError && text && !text.includes("[NOT_FOUND]") && text.trim().length > 0);
}

function safeResult(result) {
  const text = textOf(result);
  return {
    ok: Boolean(!result?.isError && text.trim()),
    isError: Boolean(result?.isError),
    textLength: text.length,
  };
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "M11A_TOOL_TIMEOUT" })), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const stageRoot = path.resolve(argument("--stage"));
  const pidFile = path.join(stageRoot, `.m11a-parity-${randomUUID()}.txt`);
  const entryPath = path.join(stageRoot, "node_modules", "korean-law-mcp", "build", "index.js");
  const dotenvResult = loadDotenv({ path: path.join(ROOT, ".env"), processEnv: {}, quiet: true });
  const lawOc = process.env.LAW_OC || dotenvResult.parsed?.LAW_OC || "";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [WRAPPER, entryPath, pidFile],
    cwd: stageRoot,
    env: { ...process.env, LAW_OC: lawOc },
  });
  const client = new Client({ name: "case-finder-m11a-parity", version: "1.0.0" }, { capabilities: {} });
  const out = { stageRoot, lawOcConfigured: Boolean(lawOc), calls: {} };

  try {
    await withTimeout(client.connect(transport), 30_000);
    const listed = await withTimeout(client.listTools(), 30_000);
    const toolNames = new Set((listed.tools || []).map((tool) => tool.name));
    out.listTools = {
      count: toolNames.size,
      required: Object.fromEntries(["search_decisions", "get_decision_text", "search_law", "get_law_text"].map((name) => [name, toolNames.has(name)])),
    };

    const decisionSearch = await withTimeout(client.callTool({
      name: "search_decisions",
      arguments: { domain: "precedent", query: DECISION_QUERY, display: 1 },
    }), 60_000);
    const decisionText = textOf(decisionSearch);
    const decisionId = decisionIdOf(decisionText);
    out.calls.search_decisions = { ...safeResult(decisionSearch), observedId: Boolean(decisionId) };
    if (decisionId) {
      const detail = await withTimeout(client.callTool({
        name: "get_decision_text",
        arguments: { domain: "precedent", id: decisionId, full: false },
      }), 60_000);
      out.calls.get_decision_text = { ...safeResult(detail), validText: validDetail(detail) };
    } else {
      out.calls.get_decision_text = { skipped: true, reason: "search_decisions did not expose an observed id" };
    }

    const lawSearch = await withTimeout(client.callTool({
      name: "search_law",
      arguments: { query: LAW_QUERY, display: 1 },
    }), 60_000);
    const lawText = textOf(lawSearch);
    const lawMst = lawMstOf(lawText);
    out.calls.search_law = { ...safeResult(lawSearch), observedMst: Boolean(lawMst) };
    if (lawMst) {
      const detail = await withTimeout(client.callTool({
        name: "get_law_text",
        arguments: { mst: lawMst },
      }), 60_000);
      out.calls.get_law_text = { ...safeResult(detail), validText: validDetail(detail) };
    } else {
      out.calls.get_law_text = { skipped: true, reason: "search_law did not expose an observed MST" };
    }
  } catch (error) {
    out.error = { code: error?.code || "M11A_PARITY_ERROR", phase: error?.code === "M11A_TOOL_TIMEOUT" ? "tool" : "connect" };
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await rm(pidFile, { force: true }).catch(() => {});
  }

  console.log(JSON.stringify(out, null, 2));
}

await main();
