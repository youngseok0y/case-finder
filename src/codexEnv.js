const CODEX_CHILD_ENV_KEYS = Object.freeze([
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

export function buildCodexChildEnv(source = process.env, { legalMcpLogPath = "", codexHomePath = "" } = {}) {
  const env = {};
  for (const key of CODEX_CHILD_ENV_KEYS) {
    if (typeof source?.[key] === "string" && source[key]) env[key] = source[key];
  }
  if (codexHomePath) env.CODEX_HOME = codexHomePath;
  if (legalMcpLogPath) env.LEGAL_MCP_LOG_PATH = legalMcpLogPath;
  return env;
}
