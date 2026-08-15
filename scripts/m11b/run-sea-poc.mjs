import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SEA_MAIN = path.join(ROOT, "scripts", "m11b", "sea-main.cjs");
const SEA_CHILD = path.join(ROOT, "scripts", "m11b", "sea-child.cjs");
const REMOVE_SIGNATURE = path.join(ROOT, "scripts", "m11b", "remove-pe-signature.mjs");
const EXPECTED_NODE = "v24.14.0";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}: ${result.stderr || ""}`);
  return result;
}

function parseLastJson(text) {
  const lines = String(text || "").trim().split(/\r?\n/u).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch { /* look for the structured final line */ }
  }
  return null;
}

async function main() {
  const outputRoot = path.resolve(argument("--output"));
  const nodeSource = path.resolve(argument("--node-source", process.execPath));
  if (!outputRoot) throw new Error("missing --output");
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(outputRoot, { recursive: true });
  const nodeVersion = execFileSync(nodeSource, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  if (nodeVersion !== EXPECTED_NODE) throw new Error(`SEA Node mismatch: ${nodeVersion}`);

  const configPath = path.join(outputRoot, "sea-config.json");
  const blobPath = path.join(outputRoot, "sea-prep.blob");
  const seaExe = path.join(outputRoot, "CaseFinder-SEA.exe");
  await fs.writeFile(configPath, `${JSON.stringify({
    main: SEA_MAIN,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useCodeCache: true,
    useSnapshot: false,
  }, null, 2)}\n`, "utf8");
  run(nodeSource, ["--experimental-sea-config", configPath]);
  await fs.copyFile(nodeSource, seaExe);
  run(process.execPath, [REMOVE_SIGNATURE, "--file", seaExe]);

  const npx = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const npxArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd"]
    : [];
  npxArgs.push("--yes", "--package", "postject", "postject", seaExe, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2");
  let injectionWarning = "";
  try {
    run(npx, npxArgs);
  } catch (error) {
    if (!String(error.message).includes("signature seems corrupted")) throw error;
    injectionWarning = "postject reported the expected unsigned-copy signature warning; the injected executable remained runnable";
  }

  const launched = run(seaExe, [], {
    env: { ...process.env, M11B_SEA_CHILD_PATH: SEA_CHILD },
  });
  const nativeResult = parseLastJson(launched.stdout);
  const b3a = run(seaExe, [], {
    env: { ...process.env, M11B_SEA_CHILD_PATH: SEA_CHILD, M11B_SEA_CHILD_NODE: nodeSource },
  });
  const b3aResult = parseLastJson(b3a.stdout);
  const result = {
    nodeVersion,
    seaExecutable: seaExe,
    preparationBlob: blobPath,
    injectionWarning,
    native: nativeResult,
    b3a: b3aResult,
    b3b: nativeResult?.childStdout?.includes('"role":"child-script"') ? "PASS" : "SEA_TRUE_SINGLE_EXE_REJECT",
    b3aDecision: b3aResult?.childStdout?.includes('"role":"child-script"') ? "TECHNICALLY_PASS_BUT_PRIVATE_NODE_RETAINED" : "FAIL",
    childMcpTests: "not run after the first process.execPath child stop-loss; the same SEA re-entry would violate the MCP child contract",
  };
  await fs.writeFile(path.join(outputRoot, "sea-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

await main();
