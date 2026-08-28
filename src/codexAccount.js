import { getDefaultCodexAppServerRuntime } from "./codexAppServerRuntime.js";
import { text } from "./text.js";

const LOGIN_TYPES = new Set(["chatgpt", "chatgptDeviceCode"]);

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const KST_TIME_ZONE = "Asia/Seoul";
const PREFERRED_WINDOW_DURATION_MINS = Object.freeze({
  weekly: 10_080,
  monthly: 43_200,
});

function emptyCodexQuota() {
  return {
    available: false,
    usedPercent: null,
    remainingPercent: null,
    windowDurationMins: null,
    windowKind: "unknown",
    windowLabel: "",
    resetsAt: null,
    resetLabel: "",
  };
}

function cloneCodexQuota(value) {
  return { ...emptyCodexQuota(), ...(value || {}) };
}

function quotaPublicView(value) {
  const quota = cloneCodexQuota(value);
  return {
    available: quota.available,
    usedPercent: quota.usedPercent,
    remainingPercent: quota.remainingPercent,
    windowDurationMins: quota.windowDurationMins,
    windowKind: quota.windowKind,
    windowLabel: quota.windowLabel,
    resetLabel: quota.resetLabel,
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
  const dayPeriod = values.dayPeriod === "AM" ? "오전" : values.dayPeriod === "PM" ? "오후" : values.dayPeriod;
  return `${values.year}년 ${values.month}월 ${values.day}일 ${dayPeriod} ${values.hour}:${values.minute}`;
}

function accountValue(result) {
  const raw = result?.account || result?.user || {};
  const requiresOpenaiAuth = Boolean(result?.requiresOpenaiAuth ?? result?.requires_openai_auth);
  const email = text(raw.email);
  const planType = text(raw.planType || raw.plan_type) || "unknown";
  const type = text(raw.type);
  const hasAccount = Boolean(type);
  return {
    loggedIn: hasAccount,
    requiresOpenaiAuth,
    email,
    planType,
    type,
    authMode: hasAccount ? type : (requiresOpenaiAuth ? "logged_out" : "not_required"),
  };
}

function limitValue(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const usedPercent = numberOrNull(raw.usedPercent ?? raw.used_percent);
  const rawDuration = numberOrNull(raw.windowDurationMins ?? raw.window_duration_mins);
  const windowDurationMins = rawDuration !== null && rawDuration > 0 ? rawDuration : null;
  const rawResetsAt = raw.resetsAt ?? raw.resets_at;
  const resetsAt = typeof rawResetsAt === "string"
    ? (rawResetsAt.trim() || null)
    : (typeof rawResetsAt === "number" && Number.isFinite(rawResetsAt) ? rawResetsAt : null);
  if (usedPercent === null && windowDurationMins === null && resetsAt === null) return null;
  return {
    usedPercent,
    windowDurationMins,
    resetsAt,
  };
}

export function rateLimitWindows(result) {
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

function hasUsedPercent(window) {
  return Number.isFinite(window?.usedPercent);
}

function isUsableWindow(window) {
  return Boolean(window && (
    Number.isFinite(window.windowDurationMins)
    || hasUsedPercent(window)
    || window.resetsAt !== null
  ));
}

function firstUsefulWindow(windows) {
  return windows.find(hasUsedPercent) || windows[0] || null;
}

export function selectCodexQuotaWindow(windows = []) {
  const usable = (Array.isArray(windows) ? windows : []).filter(isUsableWindow);
  if (!usable.length) return null;

  for (const duration of Object.values(PREFERRED_WINDOW_DURATION_MINS)) {
    const preferred = usable.filter((window) => window.windowDurationMins === duration);
    if (preferred.length) return firstUsefulWindow(preferred);
  }

  const durations = [...new Set(
    usable
      .map((window) => window.windowDurationMins)
      .filter((duration) => Number.isFinite(duration)),
  )].sort((left, right) => right - left);
  for (const duration of durations) {
    const longest = usable.filter((window) => window.windowDurationMins === duration);
    if (longest.length) return firstUsefulWindow(longest);
  }

  return firstUsefulWindow(usable);
}

export function quotaWindowKind(windowDurationMins) {
  if (windowDurationMins === PREFERRED_WINDOW_DURATION_MINS.weekly) return "weekly";
  if (windowDurationMins === PREFERRED_WINDOW_DURATION_MINS.monthly) return "monthly";
  if (Number.isFinite(windowDurationMins) && windowDurationMins > 0) return "other";
  return "unknown";
}

export function formatCodexQuotaWindowLabel(windowDurationMins) {
  const kind = quotaWindowKind(windowDurationMins);
  if (kind === "weekly") return "주간";
  if (kind === "monthly") return "월간";
  if (kind === "unknown") return "";
  if (Number.isInteger(windowDurationMins / 1_440)) return `${windowDurationMins / 1_440}일`;
  if (Number.isInteger(windowDurationMins / 60)) return `${windowDurationMins / 60}시간`;
  return `${windowDurationMins}분`;
}

export function normalizeCodexQuota(rateLimitResponse) {
  const selected = selectCodexQuotaWindow(rateLimitWindows(rateLimitResponse));
  if (!selected) return emptyCodexQuota();
  const usedPercent = hasUsedPercent(selected)
    ? Math.min(100, Math.max(0, selected.usedPercent))
    : null;
  const windowKind = quotaWindowKind(selected.windowDurationMins);
  return {
    available: true,
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.min(100, Math.max(0, 100 - usedPercent)),
    windowDurationMins: selected.windowDurationMins,
    windowKind,
    windowLabel: formatCodexQuotaWindowLabel(selected.windowDurationMins),
    resetsAt: selected.resetsAt,
    resetLabel: formatCodexResetLabel(selected.resetsAt),
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
    this.codexQuota = emptyCodexQuota();
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
    this.codexQuota = normalizeCodexQuota(result || {});
  }

  #clearAccountCache() {
    this.account = accountValue({ requiresOpenaiAuth: true });
    this.rateLimits = { source: "app_server", limits: {} };
    this.codexQuota = emptyCodexQuota();
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      await this.#readAccount();
      try {
        await this.#readRateLimits();
      } catch {
        this.rateLimits = { source: "app_server", limits: {} };
        this.codexQuota = emptyCodexQuota();
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
      codexQuota: quotaPublicView(snapshot.codexQuota),
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
      this.codexQuota = emptyCodexQuota();
      throw error;
    }
    return { source: "app_server", codexQuota: quotaPublicView(this.codexQuota) };
  }

  snapshot() {
    return {
      account: { ...this.account },
      rateLimits: { ...this.rateLimits, limits: { ...this.rateLimits.limits } },
      codexQuota: cloneCodexQuota(this.codexQuota),
      pendingLogin: Boolean(this.pendingLoginId),
    };
  }

  close() {
    this.unsubscribe?.();
  }

  #handleNotification(message) {
    if (message?.method === "account/rateLimits/updated") {
      this.rateLimits = rateLimitValue(message.params || {});
      this.codexQuota = normalizeCodexQuota(message.params || {});
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
