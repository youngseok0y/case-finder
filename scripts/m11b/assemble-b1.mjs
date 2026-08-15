import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRUNE_SCRIPT = path.join(ROOT, "scripts", "m11a", "prune-staging.mjs");
const EXPECTED_NODE = "v24.14.0";
const CODEX_TARGET = "x86_64-pc-windows-msvc";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`missing argument: ${name}`);
  return path.resolve(value);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyRequired(source, destination) {
  if (!await exists(source)) throw new Error(`required source is missing: ${source}`);
  await fs.cp(source, destination, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

async function main() {
  const sourceRoot = path.resolve(argument("--source", ROOT));
  const outputRoot = requiredArgument("--output");
  const nodeSource = path.resolve(argument("--node-source", process.execPath));
  if (outputRoot === sourceRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`output must be outside source checkout: ${outputRoot}`);
  }
  if (await exists(outputRoot)) {
    if (!process.argv.includes("--force")) throw new Error(`output exists; pass --force for an explicit rebuild: ${outputRoot}`);
    await fs.rm(outputRoot, { recursive: true, force: true });
  }

  const nodeVersion = execFileSync(nodeSource, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  if (nodeVersion !== EXPECTED_NODE) throw new Error(`pinned private Node mismatch: ${nodeVersion} !== ${EXPECTED_NODE}`);

  const appRoot = path.join(outputRoot, "app");
  const runtimeNodeRoot = path.join(outputRoot, "runtime", "node");
  const runtimeCodexRoot = path.join(outputRoot, "runtime", "codex");
  await fs.mkdir(appRoot, { recursive: true });
  await fs.mkdir(runtimeNodeRoot, { recursive: true });
  await fs.mkdir(runtimeCodexRoot, { recursive: true });
  await fs.mkdir(path.join(outputRoot, "logs"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "state"), { recursive: true });

  for (const name of ["src", "public", "prompts"]) {
    await copyRequired(path.join(sourceRoot, name), path.join(appRoot, name));
  }
  for (const name of ["config.js", "package.json", "package-lock.json"]) {
    await copyRequired(path.join(sourceRoot, name), path.join(appRoot, name));
  }
  for (const name of ["start.bat", ".env.example"]) {
    if (await exists(path.join(sourceRoot, name))) await copyRequired(path.join(sourceRoot, name), path.join(outputRoot, name));
  }
  await fs.copyFile(nodeSource, path.join(runtimeNodeRoot, "node.exe"));

  const npmCommand = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const npmArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", "ci", "--no-audit", "--no-fund"]
    : ["ci", "--no-audit", "--no-fund"];
  run(npmCommand, npmArgs, {
    cwd: appRoot,
    env: {
      ...process.env,
      CASE_FINDER_SKIP_DOTENV: "1",
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
    },
  });
  run(process.execPath, [PRUNE_SCRIPT, "--stage", appRoot, "--level", "all"]);

  const codexVendorRoot = path.join(
    appRoot,
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    CODEX_TARGET,
  );
  await copyRequired(codexVendorRoot, runtimeCodexRoot);

  const metadata = {
    candidate: "B1_PRIVATE_NODE",
    sourceRoot,
    nodeSource,
    privateNode: path.relative(outputRoot, path.join(runtimeNodeRoot, "node.exe")),
    nodeVersion,
    codexTarget: CODEX_TARGET,
    pruneProcedure: path.relative(sourceRoot, PRUNE_SCRIPT),
    npmCi: true,
    finalRuntimeInstalls: false,
  };
  await fs.writeFile(path.join(outputRoot, "m11b-assembly.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputRoot, appRoot, nodeVersion, codexTarget: CODEX_TARGET }, null, 2));
}

await main();
