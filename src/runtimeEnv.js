const RUNTIME_ENV_KEYS = Object.freeze([
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

export function buildRuntimeEnv(source = {}, extras = {}) {
  const env = {};
  for (const key of RUNTIME_ENV_KEYS) {
    if (typeof source?.[key] === "string" && source[key]) env[key] = source[key];
  }
  for (const [key, value] of Object.entries(extras)) {
    if (typeof value === "string" && value) env[key] = value;
  }
  return env;
}

export function buildLegalMcpEnv(source = {}, lawOc = "") {
  const env = buildRuntimeEnv(source);
  const value = typeof lawOc === "string" && lawOc ? lawOc : source?.LAW_OC;
  if (typeof value === "string" && value) env.LAW_OC = value;
  return env;
}
