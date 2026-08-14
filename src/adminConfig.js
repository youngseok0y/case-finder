import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const ADMIN_SETTING_KEYS = Object.freeze([
  "SEARCH_ADAPTER",
  "GEMINI_API_KEY",
  "LAW_OC",
  "CODEX_TIMEOUT_MS",
  "GCP_PROJECT_ID",
  "PORT",
  "SEARCH_DISPLAY",
]);

const SECRET_KEYS = new Set(["GEMINI_API_KEY", "LAW_OC"]);
const KEY_PATTERN = /^([A-Z][A-Z0-9_]*)\s*=.*$/u;

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function envValue(value) {
  return JSON.stringify(String(value ?? ""));
}

function validateValue(key, rawValue) {
  if (typeof rawValue !== "string" && typeof rawValue !== "number") {
    throw new Error(`ADMIN_SETTING_INVALID:${key}`);
  }
  const value = String(rawValue).trim();
  if (SECRET_KEYS.has(key)) {
    if (!value) throw new Error(`ADMIN_SECRET_EMPTY:${key}`);
    return value;
  }
  if (key === "SEARCH_ADAPTER" && !["gemini_d", "luna_native"].includes(value)) {
    throw new Error(`ADMIN_SETTING_INVALID:${key}`);
  }
  if (key === "CODEX_TIMEOUT_MS") {
    const number = Number.parseInt(value, 10);
    if (!Number.isInteger(number) || number < 30_000 || number > 600_000) throw new Error(`ADMIN_SETTING_INVALID:${key}`);
    return String(number);
  }
  if (key === "PORT") {
    const number = Number.parseInt(value, 10);
    if (!Number.isInteger(number) || number < 1 || number > 65_535) throw new Error(`ADMIN_SETTING_INVALID:${key}`);
    return String(number);
  }
  if (key === "SEARCH_DISPLAY") {
    const number = Number.parseInt(value, 10);
    if (!Number.isInteger(number) || number < 1 || number > 100) throw new Error(`ADMIN_SETTING_INVALID:${key}`);
    return String(number);
  }
  if (key === "GCP_PROJECT_ID" && value && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new Error(`ADMIN_SETTING_INVALID:${key}`);
  }
  return value;
}

export function validateAdminPatch(payload) {
  if (!isPlainObject(payload)) throw new Error("ADMIN_SETTINGS_OBJECT_REQUIRED");
  const unknown = Object.keys(payload).filter((key) => !ADMIN_SETTING_KEYS.includes(key));
  if (unknown.length) throw new Error(`ADMIN_SETTING_NOT_ALLOWED:${unknown.join(",")}`);
  const values = {};
  for (const [key, rawValue] of Object.entries(payload)) {
    if (SECRET_KEYS.has(key) && String(rawValue ?? "").trim() === "") continue;
    values[key] = validateValue(key, rawValue);
  }
  if (Object.keys(values).length === 0) throw new Error("ADMIN_NO_SETTINGS_TO_WRITE");
  return values;
}

function replaceOrAppend(text, values) {
  const pending = new Map(Object.entries(values));
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const next = lines.map((line) => {
    const match = line.match(KEY_PATTERN);
    if (!match || !pending.has(match[1])) return line;
    const key = match[1];
    pending.delete(key);
    return `${key}=${envValue(values[key])}`;
  });
  for (const [key, value] of pending) next.push(`${key}=${envValue(value)}`);
  return `${next.filter((line, index) => index < next.length - 1 || line !== "").join("\n").replace(/\n+$/u, "")}\n`;
}

export async function writeAdminSettings(values, envPath = config.runtimePaths.envPath) {
  const directory = path.dirname(envPath);
  await fs.mkdir(directory, { recursive: true });
  const current = await fs.readFile(envPath, "utf8").catch(() => "");
  const temporary = `${envPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, replaceOrAppend(current, values), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, envPath);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return Object.keys(values);
}

export function adminSettingsView() {
  return {
    adapter: config.searchAdapter,
    adapterOptions: [
      { id: "gemini_d", label: "Gemini 빠른 검색" },
      { id: "luna_native", label: "Luna 고정밀 검색" },
    ],
    configured: {
      geminiApiKey: Boolean(config.geminiApiKey),
      lawOc: Boolean(config.lawOc),
      gcpProjectId: Boolean(process.env.GCP_PROJECT_ID),
    },
    values: {
      codexTimeoutMs: config.codexTimeoutMs,
      port: config.port,
      searchDisplay: config.searchDisplay,
    },
    restartRequired: true,
  };
}
