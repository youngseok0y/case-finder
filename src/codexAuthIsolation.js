import fs from "node:fs/promises";
import path from "node:path";

export const CODEX_AUTH_ISOLATION_UNSAFE = "CODEX_AUTH_ISOLATION_UNSAFE";
export const CODEX_AUTH_HOME_UNAVAILABLE = "CODEX_AUTH_HOME_UNAVAILABLE";

function isolationError(code, message, cause = null) {
  const error = new Error(`${code}:${message}`);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function isWindows(platform) {
  return platform === "win32";
}

function normalizedPath(value, platform) {
  const separator = isWindows(platform) ? "\\" : path.sep;
  let result = path.resolve(String(value)).replace(/[\\/]+/g, separator);
  if (result.length > 1 && result.endsWith(separator) && !(isWindows(platform) && result.length === 3)) {
    result = result.slice(0, -1);
  }
  return isWindows(platform) ? result.toLowerCase() : result;
}

function sameOrDescendant(value, root, platform) {
  const candidate = normalizedPath(value, platform);
  const base = normalizedPath(root, platform);
  const separator = isWindows(platform) ? "\\" : path.sep;
  return candidate === base || (base.endsWith(separator) ? candidate.startsWith(base) : candidate.startsWith(`${base}${separator}`));
}

function globalCodexPaths(source) {
  const homes = [
    source?.USERPROFILE,
    source?.HOME,
    source?.HOMEDRIVE && source?.HOMEPATH ? `${source.HOMEDRIVE}${source.HOMEPATH}` : "",
  ].filter((value) => typeof value === "string" && value.trim());
  return [...new Set(homes.map((value) => path.join(value, ".codex")))];
}

async function realpathIfPresent(fsImpl, value) {
  try {
    return await fsImpl.realpath(value);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return "";
    throw error;
  }
}

function isTableHeader(line) {
  return /^\s*\[\[?/.test(line);
}

function upsertTopLevelCredentialStore(source) {
  const input = typeof source === "string" ? source : "";
  const newline = input.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = /\r?\n$/u.test(input);
  const lines = input ? input.split(/\r\n|\n/u) : [];
  if (hadTrailingNewline) lines.pop();

  let inTable = false;
  let replaced = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (isTableHeader(lines[index])) inTable = true;
    if (!inTable) {
      const match = lines[index].match(/^(\s*)cli_auth_credentials_store\s*=/iu);
      if (match) {
        lines[index] = `${match[1]}cli_auth_credentials_store = "file"`;
        replaced = true;
        break;
      }
    }
  }

  if (!replaced) {
    const firstTable = lines.findIndex(isTableHeader);
    const keyLine = 'cli_auth_credentials_store = "file"';
    if (firstTable >= 0) lines.splice(firstTable, 0, keyLine);
    else lines.push(keyLine);
  }

  return `${lines.join(newline)}${newline}`;
}

async function readConfigFile(fsImpl, configPath) {
  try {
    const stat = await fsImpl.lstat(configPath);
    if (stat.isSymbolicLink()) {
      throw isolationError(CODEX_AUTH_ISOLATION_UNSAFE, "dedicated config.toml is a symbolic link");
    }
    return await fsImpl.readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    if (error?.code?.startsWith("CODEX_AUTH_")) throw error;
    throw isolationError(CODEX_AUTH_HOME_UNAVAILABLE, "dedicated config.toml could not be read", error);
  }
}

async function ensureCredentialStore(fsImpl, configPath, realHomePath, platform) {
  const current = await readConfigFile(fsImpl, configPath);
  const next = upsertTopLevelCredentialStore(current);
  if (next !== current) {
    try {
      await fsImpl.writeFile(configPath, next, "utf8");
    } catch (error) {
      throw isolationError(CODEX_AUTH_HOME_UNAVAILABLE, "dedicated config.toml could not be written", error);
    }
  }

  try {
    const stat = await fsImpl.lstat(configPath);
    if (stat.isSymbolicLink()) {
      throw isolationError(CODEX_AUTH_ISOLATION_UNSAFE, "dedicated config.toml became a symbolic link");
    }
    const realConfigPath = await fsImpl.realpath(configPath);
    if (!sameOrDescendant(realConfigPath, realHomePath, platform)) {
      throw isolationError(CODEX_AUTH_ISOLATION_UNSAFE, "dedicated config.toml resolves outside the dedicated home");
    }
  } catch (error) {
    if (error?.code?.startsWith("CODEX_AUTH_")) throw error;
    throw isolationError(CODEX_AUTH_HOME_UNAVAILABLE, "dedicated config.toml could not be verified", error);
  }
}

export async function prepareCodexHome(
  codexHomePath,
  { source = process.env, fsImpl = fs, platform = process.platform } = {},
) {
  const requested = typeof codexHomePath === "string" ? codexHomePath.trim() : "";
  if (!requested || !path.isAbsolute(requested)) {
    throw isolationError(CODEX_AUTH_ISOLATION_UNSAFE, "dedicated CODEX_HOME must be a non-empty absolute path");
  }

  const forbiddenPaths = globalCodexPaths(source);
  if (forbiddenPaths.some((candidate) => sameOrDescendant(requested, candidate, platform))) {
    throw isolationError(CODEX_AUTH_ISOLATION_UNSAFE, "dedicated CODEX_HOME overlaps a global Codex home");
  }

  try {
    await fsImpl.mkdir(requested, { recursive: true });
  } catch (error) {
    throw isolationError(CODEX_AUTH_HOME_UNAVAILABLE, "dedicated CODEX_HOME could not be created", error);
  }

  let realHomePath;
  try {
    realHomePath = await fsImpl.realpath(requested);
  } catch (error) {
    throw isolationError(CODEX_AUTH_HOME_UNAVAILABLE, "dedicated CODEX_HOME could not be resolved", error);
  }

  const realForbiddenPaths = [];
  try {
    for (const candidate of forbiddenPaths) realForbiddenPaths.push(await realpathIfPresent(fsImpl, candidate));
  } catch (error) {
    throw isolationError(CODEX_AUTH_HOME_UNAVAILABLE, "global Codex home safety check failed", error);
  }
  if (forbiddenPaths.some((candidate, index) => {
    const resolvedCandidate = realForbiddenPaths[index] || candidate;
    return sameOrDescendant(realHomePath, resolvedCandidate, platform)
      || sameOrDescendant(resolvedCandidate, realHomePath, platform);
  })) {
    throw isolationError(CODEX_AUTH_ISOLATION_UNSAFE, "dedicated CODEX_HOME resolves to a global Codex home");
  }

  const configPath = path.join(requested, "config.toml");
  await ensureCredentialStore(fsImpl, configPath, realHomePath, platform);
  return { codexHomePath: requested, realHomePath, configPath };
}

export function effectiveCodexCredentialStore(response) {
  const config = response?.config && typeof response.config === "object" ? response.config : response;
  const additional = config?.additional && typeof config.additional === "object" ? config.additional : {};
  const values = [
    config?.cli_auth_credentials_store,
    config?.cliAuthCredentialsStore,
    additional.cli_auth_credentials_store,
    additional.cliAuthCredentialsStore,
  ];
  return values.find((value) => typeof value === "string" && value.trim())?.trim().toLowerCase() || "";
}

export function assertFileCredentialStore(response) {
  const store = effectiveCodexCredentialStore(response);
  if (store !== "file") {
    throw isolationError(CODEX_AUTH_ISOLATION_UNSAFE, `effective credential store is ${store || "missing"}`);
  }
  return response;
}

export { upsertTopLevelCredentialStore };
