const CASE_YEAR_SOURCE = String.raw`(?:\d{2}|(?:19|20)\d{2})`;
const CASE_NUMBER_SOURCE = String.raw`(${CASE_YEAR_SOURCE})\s*([가-힣]{1,3})\s*(\d{1,7})`;
const CASE_NO = new RegExp(String.raw`(?<!\d)${CASE_NUMBER_SOURCE}(?!\d)`, "gu");
const FULL_CASE_NUMBER = new RegExp(String.raw`^${CASE_NUMBER_SOURCE}$`, "u");

export function normalizeCaseNumber(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

export function parseCaseNumber(value) {
  const match = String(value || "").trim().match(FULL_CASE_NUMBER);
  if (!match) return null;
  return {
    year: match[1],
    typeCode: match[2],
    serial: match[3],
    caseNumber: `${match[1]}${match[2]}${match[3]}`,
  };
}

export function expandCaseNumberSet(value) {
  const source = String(value || "").replace(/\([^)]*\)/g, "").trim();
  if (!source) return new Set();

  const parts = source
    .split(/\s*(?:,|，|;|\/|·|및|등|외)\s*/u)
    .map((part) => part.replace(/^[\[\]()]+|[\[\]()]+$/g, "").trim())
    .filter(Boolean);
  const expanded = new Set();
  let prefix = "";

  for (const part of parts) {
    const full = parseCaseNumber(part);
    if (full) {
      prefix = `${full.year}${full.typeCode}`;
      expanded.add(full.caseNumber);
      continue;
    }
    const abbreviated = part.match(/^\d{1,7}$/u);
    if (abbreviated && prefix) expanded.add(`${prefix}${abbreviated[0]}`);
  }

  if (expanded.size === 0) {
    for (const match of source.matchAll(CASE_NO)) {
      expanded.add(`${match[1]}${match[2]}${match[3]}`);
    }
  }
  return expanded;
}

export function caseNumberKey(value) {
  const expanded = expandCaseNumberSet(value);
  return expanded.size > 0 ? [...expanded].sort().join("|") : normalizeCaseNumber(value);
}

export function caseNumberIncludes(container, expected) {
  const expectedSet = expandCaseNumberSet(expected);
  const containerSet = expandCaseNumberSet(container);
  if (expectedSet.size === 0 || containerSet.size === 0) {
    return normalizeCaseNumber(container) === normalizeCaseNumber(expected);
  }
  return [...expectedSet].every((caseNumber) => containerSet.has(caseNumber));
}

export function caseNumberMatches(left, right) {
  return caseNumberIncludes(left, right) || caseNumberIncludes(right, left);
}

export function extractCaseNumbers(query) {
  const source = String(query || "");
  const matches = [];
  const seen = new Set();

  for (const match of source.matchAll(CASE_NO)) {
    const caseNumber = `${match[1]}${match[2]}${match[3]}`;
    if (seen.has(caseNumber)) continue;
    seen.add(caseNumber);
    matches.push({
      caseNumber,
      typeCode: match[2],
      domain: match[2].startsWith("헌") ? "constitutional" : "precedent",
    });
  }

  return matches;
}

export function routeQuery(query, maxCases = 5) {
  const matches = extractCaseNumbers(query);
  return {
    kind: matches.length > 0 ? "direct" : "natural",
    cases: matches.slice(0, maxCases),
    ignoredCaseCount: Math.max(0, matches.length - maxCases),
  };
}
