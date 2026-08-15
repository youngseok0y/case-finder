import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WRAPPER = path.join(ROOT, "scripts", "m11a", "mcp-server-wrapper.mjs");
const REQUIRED_TOOLS = ["search_decisions", "get_decision_text", "search_law", "get_law_text"];

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function numberArgument(name, fallback) {
  const value = Number(argument(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function treeMetrics(rootPath) {
  let bytes = 0;
  let files = 0;
  let dirs = 0;
  let nativeFiles = 0;
  const nativeExtensions = new Set([".node", ".dll", ".exe", ".wasm"]);
  const pending = [path.resolve(rootPath)];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        dirs += 1;
        pending.push(entryPath);
      } else if (entry.isFile()) {
        const info = await stat(entryPath);
        bytes += info.size;
        files += 1;
        if (nativeExtensions.has(path.extname(entry.name).toLowerCase())) nativeFiles += 1;
      }
    }
  }

  return { bytes, files, dirs, nativeFiles };
}

function powershellMemory(pid) {
  if (process.platform !== "win32") return null;
  const command = [
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if ($p) { '{0},{1},{2}' -f $p.WorkingSet64,$p.PrivateMemorySize64,$p.PagedMemorySize64 }",
  ].join("; ");
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const [workingSet, privateBytes, pagedBytes] = output.split(",").map(Number);
    if (![workingSet, privateBytes, pagedBytes].every(Number.isFinite)) return null;
    return { workingSet, privateBytes, pagedBytes };
  } catch {
    return null;
  }
}

async function waitForPid(pidFile, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
      if (Number.isInteger(value) && value > 0) return value;
    } catch {
      // The wrapper writes the pid immediately before importing the MCP server.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`MCP server pid file was not written: ${pidFile}`);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function mean(values) {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function range(values) {
  return values.length > 0 ? { min: Math.min(...values), max: Math.max(...values) } : null;
}

async function runListTools(stageRoot, memorySamples) {
  const pidFile = path.join(stageRoot, `.m11a-pid-${randomUUID()}.txt`);
  const entryPath = path.join(stageRoot, "node_modules", "korean-law-mcp", "build", "index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [WRAPPER, entryPath, pidFile],
    cwd: stageRoot,
    env: { ...process.env, LAW_OC: process.env.LAW_OC || "" },
  });
  const client = new Client({ name: "case-finder-m11a-measurement", version: "1.0.0" }, { capabilities: {} });
  const started = performance.now();
  let pid = null;
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const startupMs = performance.now() - started;
    pid = await waitForPid(pidFile);
    const memory = [];
    for (let index = 0; index < memorySamples; index += 1) {
      const sample = powershellMemory(pid);
      if (sample) memory.push(sample);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const names = (listed.tools || []).map((tool) => tool.name);
    return {
      startupMs,
      toolCount: names.length,
      requiredTools: Object.fromEntries(REQUIRED_TOOLS.map((name) => [name, names.includes(name)])),
      pid,
      memorySamples: memory,
    };
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    await rm(pidFile, { force: true }).catch(() => {});
  }
}

async function main() {
  const stageRoot = path.resolve(argument("--stage"));
  const coldSamples = numberArgument("--cold-samples", 7);
  const memorySamples = numberArgument("--memory-samples", 5);
  const nodeModules = path.join(stageRoot, "node_modules");
  const metricPaths = {
    nodeModules,
    koreanLawMcp: path.join(nodeModules, "korean-law-mcp"),
    kordoc: path.join(nodeModules, "kordoc"),
    transformers: path.join(nodeModules, "@huggingface", "transformers"),
    pdfium: path.join(nodeModules, "@hyzyla", "pdfium"),
    onnxRoot: path.join(nodeModules, "onnxruntime-node"),
    onnxNested: path.join(nodeModules, "@huggingface", "transformers", "node_modules", "onnxruntime-node"),
    pdfjsRoot: path.join(nodeModules, "pdfjs-dist"),
    pdfjsNested: path.join(nodeModules, "kordoc", "node_modules", "pdfjs-dist"),
    sharpRoot: path.join(nodeModules, "sharp"),
    sharpNested: path.join(nodeModules, "@huggingface", "transformers", "node_modules", "sharp"),
  };
  const metrics = {};
  for (const [name, candidatePath] of Object.entries(metricPaths)) {
    try {
      metrics[name] = await treeMetrics(candidatePath);
    } catch {
      metrics[name] = null;
    }
  }

  const startup = [];
  let tools = null;
  for (let index = 0; index < coldSamples; index += 1) {
    const result = await runListTools(stageRoot, memorySamples);
    startup.push(result.startupMs);
    tools = result;
  }

  const memory = tools?.memorySamples || [];
  const memorySummary = memory.length > 0
    ? Object.fromEntries(["workingSet", "privateBytes", "pagedBytes"].map((key) => {
      const values = memory.map((sample) => sample[key]);
      return [key, { median: median(values), ...range(values) }];
    }))
    : null;

  console.log(JSON.stringify({
    stageRoot,
    node: process.version,
    npm: process.env.npm_config_user_agent || "",
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    metrics,
    coldStartMs: { samples: startup, mean: mean(startup), median: median(startup), ...range(startup) },
    tools,
    readyMemory: memorySummary,
  }, null, 2));
}

await main();
