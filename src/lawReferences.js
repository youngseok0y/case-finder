import { text } from "./text.js";

export function normalizeLawArticle(value) {
  const source = text(value).replace(/\s+/gu, "");
  const match = source.match(/^(?:제)?(\d{1,4})조(?:의(\d{1,2}))?/u);
  if (!match) return "";
  return `제${Number.parseInt(match[1], 10)}조${match[2] ? `의${Number.parseInt(match[2], 10)}` : ""}`;
}

export function normalizeLawReference(reference, { resolveLink = null } = {}) {
  if (!reference || typeof reference !== "object") return null;
  const link = text(reference.link) || (typeof resolveLink === "function" ? text(resolveLink(reference)) : "");
  return {
    ...reference,
    lawName: text(reference.lawName),
    article: text(reference.article),
    link,
  };
}

function normalizeLawName(value) {
  return text(value).replace(/\s+/gu, "").replace(/^대한민국헌법$/u, "헌법");
}

export function lawReferenceIdentityKey(reference) {
  return `${normalizeLawName(reference?.lawName)}|${text(reference?.article)}`;
}

export function lawReferenceKey(reference) {
  return `${lawReferenceIdentityKey(reference)}|${text(reference?.link)}`;
}

export function isRenderableLawReference(reference) {
  return Boolean(reference?.lawName && reference?.link);
}

export function dedupeLawReferences(references, {
  resolveLink = null,
  isRenderable = isRenderableLawReference,
} = {}) {
  const seen = new Set();
  return (Array.isArray(references) ? references : [])
    .map((reference) => normalizeLawReference(reference, { resolveLink }))
    .filter(Boolean)
    .filter((reference) => isRenderable(reference))
    .filter((reference) => {
      const key = lawReferenceKey(reference);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
