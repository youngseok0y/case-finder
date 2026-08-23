import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { buildCodexChildEnv } from "./codexEnv.js";

const CODEX_VERSION = "0.147.0";

const PLATFORM_RUNTIME = Object.freeze({
  "win32-x64": { packageName: "@openai/codex-win32-x64", target: "x86_64-pc-windows-msvc", binary: "codex.exe" },
  "win32-arm64": { packageName: "@openai/codex-win32-arm64", target: "aarch64-pc-windows-msvc", binary: "codex.exe" },
  "linux-x64": { packageName: "@openai/codex-linux-x64", target: "x86_64-unknown-linux-musl", binary: "codex" },
  "linux-arm64": { packageName: "@openai/codex-linux-arm64", target: "aarch64-unknown-linux-musl", binary: "codex" },
  "darwin-x64": { packageName: "@openai/codex-darwin-x64", target: "x86_64-apple-darwin", binary: "codex" },
  "darwin-arm64": { packageName: "@openai/codex-darwin-arm64", target: "aarch64-apple-darwin", binary: "codex" },
});

function runtimeError(code, message, cause = null) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

export function runtimeTarget(platform = process.platform, arch = process.arch) {
  return PLATFORM_RUNTIME[`${platform}-${arch}`] || null;
}

export async function resolvePackagedCodexRuntime({
  platform = process.platform,
  arch = process.arch,
  fsImpl = fs,
  resolvePackage = (name) => import.meta.resolve(name),
} = {}) {
  const target = runtimeTarget(platform, arch);
  if (!target) throw runtimeError("CODEX_APP_SERVER_PLATFORM_UNSUPPORTED", `unsupported platform: ${platform}/${arch}`);

  let packageJsonPath;
  try {
    packageJsonPath = await Promise.resolve(resolvePackage(`${target.packageName}/package.json`));
  } catch (error) {
    throw runtimeError("CODEX_APP_SERVER_RUNTIME_UNAVAILABLE", "packaged Codex runtime dependency is missing", error);
  }

  const packageRoot = path.dirname(fileURLToPath(packageJsonPath));
  const executablePath = path.join(packageRoot, "vendor", target.target, "bin", target.binary);
  try {
    await fsImpl.stat(executablePath);
  } catch (error) {
    throw runtimeError("CODEX_APP_SERVER_RUNTIME_UNAVAILABLE", "packaged Codex app-server executable is missing", error);
  }

  return {
    executablePath,
    packageName: target.packageName,
    target: target.target,
    version: CODEX_VERSION,
  };
}

export function buildCodexAppServerEnv(source = process.env) {
  const env = buildCodexChildEnv(source);
  if (!env.HOME) env.HOME = env.USERPROFILE || `${env.HOMEDRIVE || ""}${env.HOMEPATH || ""}`;
  if (!env.CODEX_HOME && env.HOME) env.CODEX_HOME = path.join(env.HOME, ".codex");
  return env;
}

export function appServerRuntimeStatus(runtime = null) {
  return {
    available: Boolean(runtime?.executablePath),
    transport: "app_server",
    dynamicTools: true,
    version: runtime?.version || CODEX_VERSION,
    packageName: runtime?.packageName || "",
    target: runtime?.target || "",
  };
}

export { CODEX_VERSION };
