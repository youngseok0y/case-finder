import { getDefaultCodexAppServerRuntime } from "./codexAppServerRuntime.js";

const LOGIN_TYPES = new Set(["chatgpt", "chatgptDeviceCode"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const WEEKLY_WINDOW_MINS = 10_080;
const KST_TIME_ZONE = "Asia/Seoul";

function emptyWeeklyQuota() {
  return {
    available: false,
    usedPercent: null,
    remainingPercent: null,
    resetsAt: null,
    resetLabel: "",
  };
}

function cloneWeeklyQuota(value) {
  return { ...emptyWeeklyQuota(), ...(value || {}) };
}

function weeklyPublicView(value) {
  const weekly = cloneWeeklyQuota(value);
  return {
    available: weekly.available,
    usedPercent: weekly.usedPercent,
    remainingPercent: weekly.remainingPercent,
    resetLabel: weekly.resetLabel,
  };
}

function resetMilliseconds(value) {
  const number = numberOrNull(value);
  if (number === null || number <= 0) return null;
  return number >= 1_000_000_000_000 ? number : number * 1_000;
}

export function formatCodexResetLabel(value, timeZone = KST_TIME_ZONE) {
  const milliseconds = resetMilliseconds(value);
  if (milliseconds === null) return "";
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    calendar: "gregory",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  if (!values.year || !values.month || !values.day || !values.dayPeriod || !values.hour || !values.minute) return "";
  return `${values.year}년 ${values.month}월 ${values.day}일 ${values.dayPeriod} ${values.hour}:${values.minute}`;
}

function accountValue(result) {
  const raw = result?.account || result?.user || {};
  const requiresOpenaiAuth = Boolean(result?.requiresOpenaiAuth ?? result?.requires_openai_auth);
  const email = text(raw.email);
  const planType = text(raw.planType || raw.plan_type) || "unknown";
  const type = text(raw.type);
  return {
    loggedIn: !requiresOpenaiAuth && Boolean(email || type),
    requiresOpenaiAuth,
    email,
    planType,
    type,
    authMode: requiresOpenaiAuth ? "logged_out" : (type || (email ? "chatgpt" : "unknown")),
  };
}

function limitValue(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const usedPercent = numberOrNull(raw.usedPercent ?? raw.used_percent);
  const windowDurationMins = numberOrNull(raw.windowDurationMins ?? raw.window_duration_mins);
  const resetsAt = raw.resetsAt ?? raw.resets_at;
  if (usedPercent === null && windowDurationMins === null && resetsAt === undefined) return null;
  return {
    usedPercent,
    windowDurationMins,
    resetsAt: typeof resetsAt === "string" || typeof resetsAt === "number" ? resetsAt : null,
  };
}

function rateLimitWindows(result) {
  const root = result?.rateLimits || result?.rate_limits || result || {};
  const windows = [];
  const add = (source, value) => {
    const normalized = limitValue(value);
    if (normalized) windows.push({ source, ...normalized });
  };

  for (const name of ["primary", "secondary"]) add(name, root[name]);
  if (limitValue(root)) add("root", root);

  const byLimitId = result?.rateLimitsByLimitId
    || result?.rate_limits_by_limit_id
    || root?.rateLimitsByLimitId
    || root?.rate_limits_by_limit_id
    || {};
  for (const [limitId, value] of Object.entries(byLimitId)) {
    const limits = value?.rateLimits || value?.rate_limits || value || {};
    for (const name of ["primary", "secondary"]) add(`${limitId}.${name}`, limits[name]);
    if (limitValue(limits)) add(limitId, limits);
  }
  return windows;
}

export function normalizeCodexWeeklyQuota(rateLimitResponse) {
  const weekly = rateLimitWindows(rateLimitResponse)
    .filter((window) => window.windowDurationMins === WEEKLY_WINDOW_MINS)
    .find((window) => window.usedPercent !== null)
    || rateLimitWindows(rateLimitResponse).find((window) => window.windowDurationMins === WEEKLY_WINDOW_MINS);
  if (!weekly || weekly.usedPercent === null) return emptyWeeklyQuota();
  const usedPercent = Math.min(100, Math.max(0, weekly.usedPercent));
  return {
    available: true,
    usedPercent,
    remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
    resetsAt: weekly.resetsAt,
    resetLabel: formatCodexResetLabel(weekly.resetsAt),
  };
}

function rateLimitValue(result) {
  const raw = result?.rateLimits || result?.rate_limits || result || {};
  const limits = {};
  const topLevel = limitValue(raw);
  if (topLevel) limits.primary = topLevel;
  for (const [name, value] of Object.entries(raw)) {
    const normalized = limitValue(value);
    if (normalized) limits[name] = normalized;
  }
  for (const [name, value] of Object.entries(result?.rateLimitsByLimitId || result?.rate_limits_by_limit_id || {})) {
    const normalized = limitValue(value?.rateLimits || value?.rate_limits || value);
    if (normalized) limits[name] = normalized;
  }
  return {
    source: "app_server",
    limits,
  };
}

function loginValue(result, type) {
  return {
    type,
    loginId: text(result?.loginId || result?.login_id),
    authUrl: text(result?.authUrl || result?.auth_url),
    verificationUrl: text(result?.verificationUrl || result?.verification_url),
    userCode: text(result?.userCode || result?.user_code),
    source: "app_server",
  };
}

export class CodexAccountManager {
  constructor({ runtime = getDefaultCodexAppServerRuntime() } = {}) {
    this.runtime = runtime;
    this.account = accountValue({ requiresOpenaiAuth: true });
    this.rateLimits = { source: "app_server", limits: {} };
    this.codexWeekly = emptyWeeklyQuota();
    this.pendingLoginId = "";
    this.refreshPromise = null;
    this.unsubscribe = runtime.onNotification((message) => this.#handleNotification(message));
  }

  async #readAccount() {
    const result = await this.runtime.request("account/read", {}, { allowRestart: true });
    this.account = accountValue(result || {});
  }

  async #readRateLimits() {
    const result = await this.runtime.request("account/rateLimits/read", {}, { allowRestart: true });
    this.rateLimits = rateLimitValue(result || {});
    this.codexWeekly = normalizeCodexWeeklyQuota(result || {});
  }

  #clearAccountCache() {
    this.account = accountValue({ requiresOpenaiAuth: true });
    this.rateLimits = { source: "app_server", limits: {} };
    this.codexWeekly = emptyWeeklyQuota();
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      await this.#readAccount();
      try {
        await this.#readRateLimits();
      } catch {
        this.rateLimits = { source: "app_server", limits: {} };
        this.codexWeekly = emptyWeeklyQuota();
      }
      return this.snapshot();
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async read() {
    const snapshot = await this.refresh();
    return {
      ...snapshot.account,
      codexWeekly: weeklyPublicView(snapshot.codexWeekly),
      pendingLogin: snapshot.pendingLogin,
    };
  }

  async startLogin(type = "chatgpt") {
    if (!LOGIN_TYPES.has(type)) {
      const error = new Error("CODEX_LOGIN_TYPE_UNSUPPORTED");
      error.code = "CODEX_LOGIN_TYPE_UNSUPPORTED";
      throw error;
    }
    const result = await this.runtime.request("account/login/start", { type }, { allowRestart: true });
    const login = loginValue(result || {}, type);
    this.pendingLoginId = login.loginId;
    return login;
  }

  async cancelLogin(loginId = this.pendingLoginId) {
    const value = text(loginId);
    if (!value) return { cancelled: false, source: "app_server" };
    await this.runtime.request("account/login/cancel", { loginId: value }, { allowRestart: true });
    if (this.pendingLoginId === value) this.pendingLoginId = "";
    return { cancelled: true, source: "app_server" };
  }

  async logout() {
    await this.runtime.request("account/logout", {}, { allowRestart: true });
    this.pendingLoginId = "";
    this.account = accountValue({ requiresOpenaiAuth: true });
    return { ...this.account };
  }

  async readRateLimits() {
    try {
      await this.#readRateLimits();
    } catch (error) {
      this.rateLimits = { source: "app_server", limits: {} };
      this.codexWeekly = emptyWeeklyQuota();
      throw error;
    }
    return { source: "app_server", codexWeekly: weeklyPublicView(this.codexWeekly) };
  }

  snapshot() {
    return {
      account: { ...this.account },
      rateLimits: { ...this.rateLimits, limits: { ...this.rateLimits.limits } },
      codexWeekly: cloneWeeklyQuota(this.codexWeekly),
      pendingLogin: Boolean(this.pendingLoginId),
    };
  }

  close() {
    this.unsubscribe?.();
  }

  #handleNotification(message) {
    if (message?.method === "account/rateLimits/updated") {
      this.rateLimits = rateLimitValue(message.params || {});
      this.codexWeekly = normalizeCodexWeeklyQuota(message.params || {});
      return;
    }
    if (!["account/updated", "account/login/completed"].includes(message?.method)) return;
    this.#clearAccountCache();
    this.pendingLoginId = "";
    void this.refresh().catch(() => {});
  }
}

let defaultManager = null;

export function getDefaultCodexAccountManager(options = {}) {
  if (!defaultManager) defaultManager = new CodexAccountManager(options);
  return defaultManager;
}

export function createCodexAccountManager(options = {}) {
  return new CodexAccountManager(options);
}

export function closeDefaultCodexAccountManager() {
  defaultManager?.close();
  defaultManager = null;
}

export { accountValue as normalizeCodexAccount, rateLimitValue as normalizeCodexRateLimits };
