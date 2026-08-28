const CASE_IDENTITY_PATTERN = /(?<!\d)((?:19|20)\d{2}|\d{2})([가-힣]{1,4})(\d{1,7})$/u;
const CASE_IDENTITY_SEPARATOR = /[\s\u002D\u2010-\u2015\u2212]+/gu;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCaseIdentityText(value) {
  return text(value).normalize("NFKC").replace(CASE_IDENTITY_SEPARATOR, "").trim();
}

export function parseCaseIdentity(value) {
  const source = normalizeCaseIdentityText(value);
  const match = source.match(CASE_IDENTITY_PATTERN);
  if (!match) return null;
  return {
    year: match[1],
    typeCode: match[2],
    serial: match[3],
    caseNumber: `${match[1]}${match[2]}${match[3]}`,
  };
}

export function expandCaseIdentitySet(value) {
  const source = normalizeCaseIdentityText(value).replace(/\([^)]*\)/g, "").trim();
  if (!source) return new Set();

  const parts = source
    .split(/\s*(?:,|，|;|\/|·|및|등|외)\s*/u)
    .map((part) => part.replace(/^[\[\]()]+|[\[\]()]+$/g, "").trim())
    .filter(Boolean);
  const expanded = new Set();
  let prefix = "";

  for (const part of parts) {
    const full = parseCaseIdentity(part);
    if (full) {
      prefix = `${full.year}${full.typeCode}`;
      expanded.add(full.caseNumber);
      continue;
    }
    const abbreviated = part.match(/^\d{1,7}$/u);
    if (abbreviated && prefix) expanded.add(`${prefix}${abbreviated[0]}`);
  }

  return expanded;
}

export function canonicalCaseIdentity(value) {
  const members = [...expandCaseIdentitySet(value)].filter(Boolean).sort();
  if (members.length > 0) return members.join("|");
  return normalizeCaseIdentityText(value);
}

export function canonicalCaseNumber(value) {
  const members = [...expandCaseIdentitySet(value)].filter(Boolean).sort();
  return members.length > 0 ? members.join(",") : normalizeCaseIdentityText(value);
}

export function caseIdentityMatches(left, right) {
  const leftIdentity = canonicalCaseIdentity(left);
  const rightIdentity = canonicalCaseIdentity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}
