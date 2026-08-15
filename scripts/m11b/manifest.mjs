import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const B1_CRITICAL = [
  "runtime/node/node.exe",
  "runtime/codex/bin/codex.exe",
  "runtime/codex/bin/codex-code-mode-host.exe",
  "app/src/server.js",
  "app/config.js",
  "app/package-lock.json",
  "app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
  "app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe",
  "app/node_modules/korean-law-mcp/build/index.js",
  "app/prompts/plan.txt",
  "app/prompts/select.txt",
  "app/public/index.html",
];

const B2_CRITICAL = [
  "runtime/node/node.exe",
  "runtime/codex/bin/codex.exe",
  "runtime/codex/bin/codex-code-mode-host.exe",
  "app/case-finder.bundle.mjs",
  "app/config.js",
  "app/package-lock.json",
  "app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
  "app/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe",
  "app/node_modules/korean-law-mcp/build/index.js",
  "app/src/aoV2/restrictedMcp/stdioServer.js",
  "app/src/runtimeEnv.js",
  "app/prompts/plan.txt",
  "app/prompts/select.txt",
  "app/public/index.html",
];

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function walk(root, current = root, files = [], dirs = new Set()) {
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(root, fullPath).split(path.sep).join("/");
    if (relative === "m11b-manifest.json"
      || relative === "m11b-assembly.json"
      || relative.endsWith("/m11b-assembly.json")
      || relative.endsWith("/b2-assembly.json")) continue;
    if (relative === ".env" || relative.startsWith("logs/") || relative.startsWith("state/")) continue;
    if (entry.isDirectory()) {
      dirs.add(relative);
      await walk(root, fullPath, files, dirs);
      continue;
    }
    if (!entry.isFile()) continue;
    const data = await fs.readFile(fullPath);
    files.push({
      path: relative,
      bytes: data.byteLength,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
    });
  }
  return { files, dirs };
}

async function main() {
  const root = path.resolve(argument("--root"));
  const output = path.resolve(argument("--output", path.join(root, "m11b-manifest.json")));
  const candidate = argument("--candidate", "unknown");
  const criticalPaths = candidate.startsWith("B2", 0) ? B2_CRITICAL : B1_CRITICAL;
  if (!root || root === path.parse(root).root) throw new Error("refusing broad manifest root");
  const { files, dirs } = await walk(root);
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  const missing = criticalPaths.filter((entry) => !byPath.has(entry));
  if (missing.length) throw new Error(`critical artifact missing: ${missing.join(", ")}`);
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  const manifest = {
    version: "m11b-artifact-v1",
    candidate,
    root,
    generatedBy: path.relative(ROOT, fileURLToPath(import.meta.url)).split(path.sep).join("/"),
    pruneProcedure: "scripts/m11a/prune-staging.mjs",
    mutableExcluded: [".env", "logs/", "state/"],
    totals: { bytes: totalBytes, files: files.length, directories: dirs.size },
    critical: Object.fromEntries(criticalPaths.map((entry) => [entry, byPath.get(entry)])),
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
  };
  await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output, candidate: manifest.candidate, totals: manifest.totals }, null, 2));
}

await main();
