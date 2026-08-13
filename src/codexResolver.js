import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../config.js";

export const CODEX_CODE_MODE_HOST_NAME = "codex-code-mode-host.exe";

const WINDOWS_ENV_KEYS = Object.freeze([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
  "SYSTEMDRIVE",
  "CODEX_HOME",
]);

function isAlias(value) {
  return !value || value.toLowerCase() === "codex" || value.toLowerCase() === "codex.exe";
}

function safeExists(fsImpl, value) {
  try { return Boolean(value) && fsImpl.existsSync(value); } catch { return false; }
}

function safeReadDir(fsImpl, value) {
  try { return fsImpl.readdirSync(value, { withFileTypes: true }); } catch { return []; }
}

function pushUnique(list, seen, candidate) {
  if (!candidate?.executablePath || seen.has(candidate.executablePath)) return;
  seen.add(candidate.executablePath);
  list.push(candidate);
}

function executableCandidate(executablePath, { processExecPath = process.execPath } = {}) {
  const normalized = String(executablePath || "");
  if (!normalized) return null;
  const isNodeScript = path.extname(normalized).toLowerCase() === ".js";
  const launchPath = isNodeScript ? processExecPath : normalized;
  return {
    command: launchPath,
    prefixArgs: isNodeScript ? [normalized] : [],
    shell: false,
    executablePath: normalized,
    hostPath: path.join(path.dirname(normalized), CODEX_CODE_MODE_HOST_NAME),
  };
}

function whereCandidates({ execFile = execFileSync } = {}) {
  try {
    return execFile("where.exe", ["codex.exe"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/u)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildProbeEnv(source = process.env) {
  const env = {};
  for (const key of WINDOWS_ENV_KEYS) {
    if (typeof source?.[key] === "string" && source[key]) env[key] = source[key];
  }
  return env;
}

export function discoverCodexCandidates({
  configured = process.env.CODEX_CLI_PATH || config.codexCliPath,
  source = process.env,
  platform = process.platform,
  fsImpl = fsSync,
  execFile = execFileSync,
  processExecPath = process.execPath,
} = {}) {
  if (platform !== "win32") {
    return [executableCandidate(configured, { processExecPath })].filter(Boolean);
  }

  const candidates = [];
  const seen = new Set();
  const add = (value) => pushUnique(candidates, seen, executableCandidate(value, { processExecPath }));

  if (!isAlias(configured)) add(configured);
  for (const value of whereCandidates({ execFile })) add(value);

  const userProfile = source?.USERPROFILE || "";
  const appData = source?.APPDATA || "";
  const localAppData = source?.LOCALAPPDATA || "";
  const programFiles = source?.ProgramFiles || "C:\\Program Files";

  if (userProfile) {
    const pluginRoot = path.join(userProfile, ".codex", "plugins");
    for (const entry of safeReadDir(fsImpl, pluginRoot)) {
      if (entry.isDirectory()) add(path.join(pluginRoot, entry.name, "codex.exe"));
    }
    add(path.join(userProfile, ".codex", ".sandbox-bin", "codex.exe"));
  }

  if (appData) {
    add(path.join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
  }

  for (const root of [
    path.join(localAppData, "Programs", "Codex"),
    path.join(localAppData, "Programs", "OpenAI", "Codex"),
    path.join(programFiles, "Codex"),
    path.join(programFiles, "OpenAI", "Codex"),
  ]) {
    add(path.join(root, "codex.exe"));
  }

  return candidates;
}

export function validateCodexCandidate(candidate, {
  fsImpl = fsSync,
  execFile = execFileSync,
  source = process.env,
  versionTimeoutMs = 10_000,
} = {}) {
  if (!candidate || !safeExists(fsImpl, candidate.executablePath)) return false;
  if (!safeExists(fsImpl, candidate.hostPath)) return false;
  try {
    execFile(candidate.command, [...candidate.prefixArgs, "--version"], {
      cwd: source?.USERPROFILE || undefined,
      env: buildProbeEnv(source),
      stdio: "ignore",
      windowsHide: true,
      timeout: versionTimeoutMs,
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveCodexCommand({
  configured = process.env.CODEX_CLI_PATH || config.codexCliPath,
  source = process.env,
  platform = process.platform,
  fsImpl = fsSync,
  execFile = execFileSync,
  processExecPath = process.execPath,
} = {}) {
  if (platform !== "win32") {
    return executableCandidate(configured, { processExecPath });
  }

  const candidates = discoverCodexCandidates({
    configured,
    source,
    platform,
    fsImpl,
    execFile,
    processExecPath,
  });
  const valid = candidates.find((candidate) => validateCodexCandidate(candidate, {
    fsImpl,
    execFile,
    source,
  }));
  if (valid) return valid;

  const error = new Error("CODEX_CLI_UNAVAILABLE: no executable Codex CLI with code-mode host was found");
  error.code = "CODEX_CLI_UNAVAILABLE";
  throw error;
}
