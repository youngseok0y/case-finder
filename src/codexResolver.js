import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../config.js";
import { CODEX_CODE_MODE_HOST_NAME, resolveRuntimePaths } from "./runtimePaths.js";

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
]);

function isAlias(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || normalized === "codex" || normalized === "codex.exe";
}

function safeExists(fsImpl, value) {
  try { return Boolean(value) && fsImpl.existsSync(value); } catch { return false; }
}

function pushUnique(list, seen, candidate) {
  if (!candidate?.executablePath || seen.has(candidate.executablePath)) return;
  seen.add(candidate.executablePath);
  list.push(candidate);
}

function executableCandidate(executablePath, { source = "unknown", processExecPath = process.execPath } = {}) {
  const normalized = String(executablePath || "").trim();
  if (!normalized) return null;
  const isNodeScript = path.extname(normalized).toLowerCase() === ".js";
  const launchPath = isNodeScript ? processExecPath : normalized;
  return {
    command: launchPath,
    prefixArgs: isNodeScript ? [normalized] : [],
    shell: false,
    source,
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
  runtimePaths = resolveRuntimePaths({ appRoot: config.runtimePaths?.appRoot }),
} = {}) {
  const candidates = [];
  const seen = new Set();
  const add = (value, sourceName) => pushUnique(
    candidates,
    seen,
    executableCandidate(value, { source: sourceName, processExecPath }),
  );

  if (platform === "win32") {
    add(runtimePaths.managedCodexPath, "managed");
    if (!isAlias(configured)) add(configured, "override");
    for (const value of whereCandidates({ execFile })) add(value, "path");
    return candidates;
  }

  if (!isAlias(configured)) add(configured, "override");
  return candidates;
}

function validationFailure(candidate, code, message) {
  return { ok: false, candidate, code, message };
}

export function validateCodexCandidate(candidate, {
  fsImpl = fsSync,
  execFile = execFileSync,
  source = process.env,
  versionTimeoutMs = 10_000,
} = {}) {
  if (!candidate || !safeExists(fsImpl, candidate.executablePath)) {
    return validationFailure(candidate, "CODEX_CLI_UNAVAILABLE", "Codex CLI executable is missing");
  }
  if (!safeExists(fsImpl, candidate.hostPath)) {
    return validationFailure(candidate, "CODEX_HOST_UNAVAILABLE", "Codex code-mode host is missing");
  }
  try {
    const version = String(execFile(candidate.command, [...candidate.prefixArgs, "--version"], {
      cwd: source?.USERPROFILE || undefined,
      env: buildProbeEnv(source),
      encoding: "utf8",
      windowsHide: true,
      timeout: versionTimeoutMs,
    })).trim();
    if (!version) return validationFailure(candidate, "CODEX_VERSION_CHECK_FAILED", "Codex version output is empty");
    return { ok: true, candidate, version };
  } catch (error) {
    return validationFailure(candidate, "CODEX_VERSION_CHECK_FAILED", "Codex --version failed", error);
  }
}

function resolutionError(code, message, results, fsImpl = fsSync) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.results = results;
  error.codexAvailable = results.some((result) => result.candidate && safeExists(fsImpl, result.candidate.executablePath));
  error.codeModeHostAvailable = results.some(
    (result) => result.candidate
      && safeExists(fsImpl, result.candidate.executablePath)
      && safeExists(fsImpl, result.candidate.hostPath),
  );
  return error;
}

export function resolveCodexCommand({
  configured = process.env.CODEX_CLI_PATH || config.codexCliPath,
  source = process.env,
  platform = process.platform,
  fsImpl = fsSync,
  execFile = execFileSync,
  processExecPath = process.execPath,
  runtimePaths = resolveRuntimePaths({ appRoot: config.runtimePaths?.appRoot }),
} = {}) {
  const candidates = discoverCodexCandidates({
    configured,
    source,
    platform,
    fsImpl,
    execFile,
    processExecPath,
    runtimePaths,
  });
  if (platform !== "win32" && !candidates.length) {
    throw resolutionError("CODEX_CLI_UNAVAILABLE", "no Codex CLI override was configured", [], fsImpl);
  }

  const results = candidates.map((candidate) => validateCodexCandidate(candidate, {
    fsImpl,
    execFile,
    source,
  }));
  const valid = results.find((result) => result.ok);
  if (valid) return { ...valid.candidate, version: valid.version };

  const lastFailure = results.at(-1);
  const code = lastFailure?.code || "CODEX_CLI_UNAVAILABLE";
  const message = lastFailure?.message || "no executable Codex CLI was found";
  throw resolutionError(code, message, results, fsImpl);
}

export function getCodexRuntimeStatus(options = {}) {
  try {
    const resolved = resolveCodexCommand(options);
    return {
      configured: true,
      codexAvailable: true,
      codeModeHostAvailable: true,
      version: resolved.version,
    };
  } catch (error) {
    return {
      configured: true,
      codexAvailable: Boolean(error.codexAvailable),
      codeModeHostAvailable: Boolean(error.codeModeHostAvailable),
      version: "",
      errorCode: error.code || "CODEX_CLI_UNAVAILABLE",
    };
  }
}
