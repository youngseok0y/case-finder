import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function main() {
  const appRoot = path.resolve(argument("--app"));
  if (!appRoot) throw new Error("missing --app");
  const entry = path.join(appRoot, "src", "server.js");
  const bundle = path.join(appRoot, "case-finder.bundle.mjs");
  const bundler = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const bundlerArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd"]
    : [];
  bundlerArgs.push(
    "--yes",
    "--package",
    "esbuild",
    "esbuild",
    entry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--packages=external",
    "--outfile=case-finder.bundle.mjs",
    "--log-level=warning",
  );
  run(bundler, bundlerArgs, { cwd: appRoot });

  const sourceRoot = path.join(appRoot, "src");
  const keep = new Set(["aoV2", "runtimeEnv.js"]);
  for (const entryInfo of await fs.readdir(sourceRoot, { withFileTypes: true })) {
    if (keep.has(entryInfo.name)) continue;
    await fs.rm(path.join(sourceRoot, entryInfo.name), { recursive: true, force: true });
  }

  const metadata = {
    candidate: "B2_BUNDLED_HOST_PRIVATE_NODE",
    bundler: "esbuild (build-only via npx; not an end-user runtime dependency)",
    entry: "app/case-finder.bundle.mjs",
    externalPackages: "all npm packages (--packages=external)",
    retainedSourceForRestrictedMcp: ["app/src/aoV2/", "app/src/runtimeEnv.js"],
    mutableAssetsExternal: [".env", "logs/", "state/"],
    sourceRootThin: true,
  };
  await fs.writeFile(path.join(appRoot, "b2-assembly.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ appRoot, bundle, retainedSource: [...keep] }, null, 2));
}

await main();
