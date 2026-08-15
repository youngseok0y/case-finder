import { spawn } from "node:child_process";
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
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // The smoke result records only the HTTP status when the body is not JSON.
        }
        resolve({ status: response.statusCode || 0, body: parsed });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("request timeout"), { code: "M11A_SMOKE_TIMEOUT" })));
    request.on("error", reject);
    request.end(body);
  });
}

async function waitForHealth(port, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await requestJson(port, { method: "GET", pathname: "/health" }, 2_000);
      if (result.status > 0) return result;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw Object.assign(new Error("health timeout"), { code: "M11A_HEALTH_TIMEOUT" });
}

function summarize(response, adapter) {
  const payload = response.body && typeof response.body === "object" ? response.body : {};
  const result = payload.result && typeof payload.result === "object" ? payload.result : payload;
  return {
    adapter,
    status: response.status,
    ok: payload.ok === true || response.status === 200,
    stage: result.stage || payload.stage || "",
    terminalState: result.terminalState || payload.terminalState || "",
    itemCount: Array.isArray(result.items) ? result.items.length : null,
    fallbackSignal: Boolean(result.fallbackLabel || result.fallback_label),
  };
}

async function run() {
  const stageRoot = path.resolve(argument("--stage"));
  const adapter = argument("--adapter", "gemini_d");
  const query = argument("--query", "계약 해지 손해배상");
  const port = 37000 + Math.floor(Math.random() * 1000);
  const dotenvResult = loadDotenv({ path: path.join(ROOT, ".env"), processEnv: {}, quiet: true });
  const childEnv = {
    ...process.env,
    ...dotenvResult.parsed,
    CASE_FINDER_SKIP_DOTENV: "1",
    PORT: String(port),
    SEARCH_ADAPTER: adapter,
    CASE_FINDER_APP_ROOT: stageRoot,
    CASE_FINDER_INSTALL_ROOT: stageRoot,
    CODEX_WORKDIR: path.join(stageRoot, `.m11a-codex-workdir-${adapter}`),
  };
  const child = spawn(process.execPath, [path.join(stageRoot, "src", "server.js")], {
    cwd: stageRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.resume();
  child.stderr.resume();
  let health = null;
  let outcome;
  try {
    health = await waitForHealth(port);
    const response = await requestJson(port, {
      method: "POST",
      pathname: "/ask",
      body: JSON.stringify({ query }),
    }, 180_000);
    outcome = summarize(response, adapter);
  } catch (error) {
    outcome = { adapter, status: 0, ok: false, errorCode: error?.code || "M11A_SMOKE_ERROR" };
  } finally {
    child.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  console.log(JSON.stringify({
    stageRoot,
    adapter,
    healthStatus: health?.status || 0,
    healthOk: Boolean(health?.body?.ok),
    outcome,
  }, null, 2));
}

await run();
