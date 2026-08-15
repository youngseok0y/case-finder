const AUTH_FAILURE_PATTERNS = Object.freeze([
  /\bauthentication\s+(?:required|failed|unavailable)\b/iu,
  /\bunauthori[sz]ed\b/iu,
  /\bnot\s+logged\s+in\b/iu,
  /\b(?:login|sign[ -]?in)\s+required\b/iu,
  /\bplease\s+(?:log\s*in|sign\s*in)\b/iu,
  /\binvalid\s+access\s+token\b/iu,
  /\bexpired\s+access\s+token\b/iu,
  /\brefresh\s+token\s+expired\b/iu,
  /\btoken\s+revoked\b/iu,
]);

function errorText(value) {
  if (typeof value === "string") return value;
  if (value?.message) return String(value.message);
  if (value?.error) return errorText(value.error);
  return "";
}

export function isCodexAuthFailure(value) {
  const text = errorText(value);
  return AUTH_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}
