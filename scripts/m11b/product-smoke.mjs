import { execFileSync, spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function requestJson(port, { method, pathname, body = "" }, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers: {
        ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let bodyJson = null;
        try { bodyJson = JSON.parse(raw); } catch { /* status is sufficient for failures */ }
        resolve({ status: response.statusCode || 0, body: bodyJson });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("request timeout"), { code: "M11B_SMOKE_TIMEOUT" })));
    request.on("error", reject);
    request.end(body);
  });
}

async function waitForHealth(port, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await requestJson(port, { method: "GET", pathname: "/health" }, 2_000);
      if (result.status > 0) return result;
    } catch {
      // The private-Node server may still be starting its restricted MCP child.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error("health timeout"), { code: "M11B_HEALTH_TIMEOUT" });
}

function noSystemNodePath(source = process.env) {
  const pathValue = String(source.PATH || source.Path || "");
  const nodeSegments = pathValue.split(path.delimiter).filter((entry) => /nodejs|npm/iu.test(entry));
  return { passed: nodeSegments.length === 0, removedSegments: nodeSegments.length };
}

function buildTargetEnv({ installRoot, appRoot, port, adapter }) {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const systemPath = [path.join(systemRoot, "System32"), systemRoot].join(path.delimiter);
  const env = {
    ...process.env,
    ...loadDotenv({ path: path.join(ROOT, ".env"), processEnv: {}, quiet: true }).parsed,
    CASE_FINDER_SKIP_DOTENV: "1",
    CASE_FINDER_INSTALL_ROOT: installRoot,
    CASE_FINDER_APP_ROOT: appRoot,
    CASE_FINDER_ENV_PATH: path.join(installRoot, ".env"),
    CODEX_WORKDIR: path.join(installRoot, "state", `m11b-${adapter}`),
    PORT: String(port),
    SEARCH_ADAPTER: adapter,
    PATH: systemPath,
    Path: systemPath,
    npm_config_user_agent: undefined,
  };
  delete env.npm_config_user_agent;
  return env;
}

function summarize(response, adapter, queryKind) {
  const payload = response.body && typeof response.body === "object" ? response.body : {};
  const result = payload.result && typeof payload.result === "object" ? payload.result : payload;
  return {
    adapter,
    queryKind,
    status: response.status,
    ok: response.status === 200 && payload.ok === true,
    service: payload.service || "",
    stage: payload.stage || result.stage || "",
    terminalState: result.terminalState || payload.terminalState || "",
    itemCount: Array.isArray(result.items) ? result.items.length : null,
    fallbackSignal: Boolean(result.fallbackLabel || result.fallback_label),
  };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    try { execFileSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch { child.kill(); }
  } else {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

async function main() {
  const installRoot = path.resolve(argument("--install-root"));
  const appRoot = path.resolve(argument("--app-root", path.join(installRoot, "app")));
  const nodeExecutable = path.resolve(argument("--node", path.join(installRoot, "runtime", "node", "node.exe")));
  const entry = path.resolve(argument("--entry", path.join(appRoot, "src", "server.js")));
  const adapter = argument("--adapter", "gemini_d");
  const queryKind = argument("--kind", "natural");
  const query = argument("--query", queryKind === "direct" ? "99두2963" : "계약 해지 손해배상");
  const port = 38000 + Math.floor(Math.random() * 1000);
  const nodeVersion = execFileSync(nodeExecutable, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  const targetEnv = buildTargetEnv({ installRoot, appRoot, port, adapter });
  const child = spawn(nodeExecutable, [entry], {
    cwd: appRoot,
    env: targetEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.resume();
  child.stderr.resume();
  let health = null;
  let outcome;
  try {
    health = await waitForHealth(port);
    if (health.status !== 200) {
      outcome = { adapter, queryKind, status: health.status, ok: false, errorCode: "M11B_HEALTH_FAILED" };
    } else {
      const response = await requestJson(port, {
        method: "POST",
        pathname: "/ask",
        body: JSON.stringify({ query }),
      }, 180_000);
      outcome = summarize(response, adapter, queryKind);
    }
  } catch (error) {
    outcome = { adapter, queryKind, status: 0, ok: false, errorCode: error?.code || "M11B_SMOKE_ERROR" };
  } finally {
    await stopServer(child);
  }

  console.log(JSON.stringify({
    installRoot,
    appRoot,
    nodeVersion,
    systemNodeHidden: noSystemNodePath(targetEnv),
    health: {
      status: health?.status || 0,
      ok: Boolean(health?.body?.ok),
      service: health?.body?.service || "",
      mcpConnected: Boolean(health?.body?.mcp?.connected),
      lunaReady: Boolean(health?.body?.luna?.codexAvailable && health?.body?.luna?.codeModeHostAvailable),
    },
    outcome,
  }, null, 2));
}

await main();
