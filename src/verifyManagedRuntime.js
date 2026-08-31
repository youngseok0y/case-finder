import fs from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPackagedCodexAppServerRuntime } from "./codexAppServerRuntime.js";
import { resolveRuntimePaths } from "./runtimePaths.js";

const GOLDEN_QUERY = "임차보증금을 돌려받지 못했을 때";
const appRootFromScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installedApp = path.basename(appRootFromScript).toLowerCase() === "app";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function requiredFile(filePath, label) {
  if (!fs.existsSync(filePath)) fail("MANAGED_FILE_MISSING", `${label}:${filePath}`);
}

function versionOf(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 15_000 }).trim();
  } catch (error) {
    fail("MANAGED_VERSION_CHECK_FAILED", `${command}:${error.message}`);
  }
}

function verifyAppServerCapabilities(runtime) {
  try {
    const help = execFileSync(runtime.executablePath, ["app-server", "--help"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    if (!/app-server/iu.test(help)) fail("CODEX_APP_SERVER_CAPABILITY_MISSING", "app-server help did not advertise app-server");

    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "case-finder-app-server-schema-"));
    try {
      execFileSync(runtime.executablePath, ["app-server", "generate-json-schema", "--experimental", "--out", temporaryRoot], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
      });
      const schema = fs.readdirSync(temporaryRoot, { recursive: true })
        .map((entry) => path.join(temporaryRoot, String(entry)))
        .filter((entry) => fs.statSync(entry).isFile())
        .map((entry) => fs.readFileSync(entry, "utf8"))
        .join("\n");
      for (const marker of ["dynamicTools", "DynamicToolSpec", "item/tool/call", "account/read"]) {
        if (!schema.includes(marker)) fail("CODEX_APP_SERVER_DYNAMIC_TOOLS_UNSUPPORTED", `schema marker missing:${marker}`);
      }
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code?.startsWith("CODEX_APP_SERVER_")) throw error;
    fail("CODEX_APP_SERVER_DYNAMIC_TOOLS_UNSUPPORTED", error.message);
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHealth(
  port,
  child,
  { fetchImpl = fetch, sleep = () => new Promise((resolve) => setTimeout(resolve, 500)) } = {},
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) fail("MANAGED_SERVER_EXITED", `exit:${child.exitCode}`);
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${port}/health`, {}, 2_000, fetchImpl);
      if (response.status === 200) return await response.json();
    } catch {
      // The server may still be starting.
    }
    await sleep();
  }
  fail("MANAGED_HEALTH_TIMEOUT", `port:${port}`);
}

async function runGoldenQuery(port, query) {
  const startedAt = Date.now();
  const response = await fetchWithTimeout(`http://127.0.0.1:${port}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  }, 150_000);
  const body = await response.json().catch(() => ({}));
  if (response.status === 503 && /로그인|인증|auth|login/iu.test(String(body.message || ""))) {
    fail("LUNA_AUTH_REQUIRED", String(body.message || "authentication required"));
  }
  if (response.status !== 200) fail("LUNA_GOLDEN_FAILED", `http:${response.status}`);
  if (body.stage !== "LUNA_NATIVE") fail("LUNA_GOLDEN_FAILED", `stage:${body.stage || "missing"}`);
  const items = body.result?.items;
  if (!Array.isArray(items) || items.length === 0 || !items.every((item) => item.status === "verified")) {
    fail("LUNA_GOLDEN_FAILED", "verified-only result was not returned");
  }
  return {
    status: response.status,
    stage: body.stage,
    verifiedItems: items.length,
    terminalState: body.result?.terminalState || "",
    elapsedMs: Date.now() - startedAt,
    telemetry: body.result?.telemetry || null,
  };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      child.kill();
    }
  } else {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function main() {
  const explicitRoot = optionValue("--install-root") || process.env.CASE_FINDER_INSTALL_ROOT || "";
  const defaultInstallRoot = installedApp ? path.resolve(appRootFromScript, "..") : appRootFromScript;
  const installRoot = path.resolve(explicitRoot || defaultInstallRoot);
  const appRoot = process.env.CASE_FINDER_APP_ROOT
    || (explicitRoot ? path.join(installRoot, "app") : appRootFromScript);
  const source = {
    ...process.env,
    CASE_FINDER_INSTALL_ROOT: installRoot,
    CASE_FINDER_APP_ROOT: appRoot,
  };
  const paths = resolveRuntimePaths({ source, appRoot });

  requiredFile(paths.managedNodePath, "managed node");
  requiredFile(paths.serverPath, "server");

  const nodeVersion = versionOf(paths.managedNodePath, ["--version"]);
  const appServerRuntime = await inspectPackagedCodexAppServerRuntime({ platform: "win32", arch: "x64" });
  verifyAppServerCapabilities(appServerRuntime);

  const port = Number.parseInt(optionValue("--port") || process.env.M9RR3_VERIFY_PORT || "3311", 10);
  const query = optionValue("--query") || GOLDEN_QUERY;
  const childEnv = {
    ...process.env,
    CASE_FINDER_INSTALL_ROOT: installRoot,
    CASE_FINDER_APP_ROOT: appRoot,
    CASE_FINDER_ENV_PATH: process.env.CASE_FINDER_ENV_PATH || paths.envPath,
    PORT: String(port),
    SEARCH_ADAPTER: process.env.SEARCH_ADAPTER || "luna_native",
  };
  const child = spawn(paths.managedNodePath, [paths.serverPath], {
    cwd: paths.appRoot,
    env: childEnv,
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    const health = await waitForHealth(port, child);
    if (health.service !== "case-finder" || health.ok !== true) {
      fail("MANAGED_HEALTH_FAILED", `service:${health.service || "missing"};ok:${String(health.ok)};keys:${Object.keys(health).join(",")}`);
    }
    if (health.mcp?.connected !== true) fail("MANAGED_MCP_STARTUP_FAILED", "restricted MCP is not connected");
    const result = process.argv.includes("--skip-query") ? null : await runGoldenQuery(port, query);
    console.log(JSON.stringify({
      status: "M11_CODEX_APP_SERVER_PASS",
      installRoot,
      nodeVersion,
      appServerRuntime,
      health: { status: 200, mcpConnected: health.mcp.connected, codex: health.codex, luna: health.luna },
      golden: result,
    }));
  } finally {
    await stopServer(child);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "M11_CODEX_APP_SERVER_BLOCKED",
      code: error.code || "MANAGED_RUNTIME_VERIFICATION_FAILED",
      message: error.message,
    }));
    process.exitCode = 1;
  });
}
