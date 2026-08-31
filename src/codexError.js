import { isCodexAuthFailure } from "./codexAuth.js";

export const CODEX_ERROR_CATEGORIES = Object.freeze({
  AUTH: "AUTH",
  RUNTIME: "RUNTIME",
  PROTOCOL: "PROTOCOL",
  INPUT: "INPUT",
  UNKNOWN: "UNKNOWN",
});

export function codexErrorCode(error) {
  return String(error?.code || String(error?.message || "").split(":", 1)[0]);
}

export function classifyCodexError(error) {
  const code = codexErrorCode(error);
  if (code === "CODEX_LOGIN_TYPE_UNSUPPORTED" || code === "CODEX_API_REQUEST_INVALID" || code === "CODEX_APP_SERVER_PROMPT_REQUIRED") {
    return CODEX_ERROR_CATEGORIES.INPUT;
  }
  if (code.startsWith("CODEX_AUTH_") || isCodexAuthFailure(error)) {
    return CODEX_ERROR_CATEGORIES.AUTH;
  }
  if (code.startsWith("CODEX_APP_SERVER_")) {
    return /(?:FINAL_INVALID|METHOD_UNSUPPORTED|PROTOCOL|THREAD_ID_MISSING|TURN_ID_MISSING)/u.test(code)
      ? CODEX_ERROR_CATEGORIES.PROTOCOL
      : CODEX_ERROR_CATEGORIES.RUNTIME;
  }
  if (code.startsWith("CODEX_NATIVE_")) {
    return /(?:FINAL_MISSING|TOOL_RESPONSE_REQUIRED)/u.test(code)
      ? CODEX_ERROR_CATEGORIES.PROTOCOL
      : CODEX_ERROR_CATEGORIES.RUNTIME;
  }
  return CODEX_ERROR_CATEGORIES.UNKNOWN;
}

export function isCodexUnavailable(error) {
  const category = classifyCodexError(error);
  return category === CODEX_ERROR_CATEGORIES.AUTH
    || category === CODEX_ERROR_CATEGORIES.RUNTIME
    || category === CODEX_ERROR_CATEGORIES.PROTOCOL;
}
