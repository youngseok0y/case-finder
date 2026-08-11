import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { caseNumberMatches } from "../src/router.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(await fs.readFile(path.join(currentDir, "golden.json"), "utf8"));
const args = new Set(process.argv.slice(2));

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const baseUrl = option("base-url", process.env.CASE_FINDER_BASE_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const mode = option("mode", process.env.PIPELINE_MODE || "unknown");
const repeat = Math.max(1, Number.parseInt(option("repeat", "1"), 10) || 1);
const includeNatural = args.has("--include-natural");
const timeoutMs = Math.max(5_000, Number.parseInt(option("timeout-ms", "120000"), 10) || 120_000);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function lawUrl(value) {
  try {
    const url = new URL(value);
    assert(url.protocol === "https:" && url.hostname === "www.law.go.kr", `법령 링크 호스트가 올바르지 않습니다: ${value}`);
    assert(!url.searchParams.has("OC"), `법령 링크에 OC가 포함됐습니다: ${value}`);
    return url;
  } catch (error) {
    fail(`법령 링크가 올바른 URL이 아닙니다: ${value} (${error.message})`);
  }
}

function caseUrl(value) {
  try {
    const url = new URL(value);
    assert(url.protocol === "https:" && url.hostname === "www.law.go.kr", `판례 링크 호스트가 올바르지 않습니다: ${value}`);
    assert(!url.searchParams.has("OC"), `판례 링크에 OC가 포함됐습니다: ${value}`);
    assert(["/LSW/precInfoP.do", "/LSW/detcInfoP.do"].includes(url.pathname), `판례 링크 경로가 올바르지 않습니다: ${value}`);
    return url;
  } catch (error) {
    fail(`판례 링크가 올바른 URL이 아닙니다: ${value} (${error.message})`);
  }
}

async function ask(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    const payload = await response.json();
    assert(response.ok && payload.ok, `${query}: HTTP 검색 실패(${response.status})`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function selectedSignature(result) {
  return (result.selected || [])
    .map((item) => `${item.caseNumber}:${item.match}`)
    .sort()
    .join("|");
}

function validatePayload(testCase, payload) {
  const result = payload.result || {};
  const items = Array.isArray(result.items) ? result.items : [];
  const html = String(payload.html || "");
  if (testCase.kind === "direct") assert(payload.route === "direct", `${testCase.id}: direct 라우트가 아닙니다.`);
  if (testCase.kind === "natural") assert(payload.route === "natural", `${testCase.id}: natural 라우트가 아닙니다.`);

  if (testCase.expectNoItems) {
    assert(items.length === 0, `${testCase.id}: 없어야 할 결과가 ${items.length}건 있습니다.`);
    if (testCase.htmlIncludes) assert(html.includes(testCase.htmlIncludes), `${testCase.id}: HTML에 '${testCase.htmlIncludes}'가 없습니다.`);
  }

  if (testCase.expectedCaseNumbers) {
    const matched = testCase.expectedCaseNumbers.some((expected) => items.some((item) => caseNumberMatches(item.caseNumber, expected)));
    assert(matched, `${testCase.id}: 기대 사건번호가 결과에 없습니다.`);
  }
  if (testCase.minItems !== undefined) assert(items.length >= testCase.minItems, `${testCase.id}: 결과 ${items.length}건, 최소 ${testCase.minItems}건이 필요합니다.`);
  if (testCase.requireCaseLinks) assert(items.every((item) => item.link), `${testCase.id}: 링크 없는 판례가 있습니다.`);

  for (const item of items) {
    if (item.link) {
      const url = caseUrl(item.link);
      if (testCase.expectedCasePath) assert(url.pathname === testCase.expectedCasePath, `${testCase.id}: 예상 판례 링크 경로와 다릅니다.`);
    }
    if (testCase.kind === "natural" && item.status === "verified") {
      assert((result.candidateCaseNumbers || []).some((candidate) => caseNumberMatches(candidate, item.caseNumber)), `${testCase.id}: 후보 목록 밖 사건번호가 출력됐습니다.`);
    }
  }

  const lawReferences = Array.isArray(result.lawReferences) ? result.lawReferences : [];
  for (const reference of lawReferences) {
    if (!reference.link) continue;
    const url = lawUrl(reference.link);
    if (testCase.expectedLawPath) assert(url.pathname === testCase.expectedLawPath, `${testCase.id}: 예상 법령 링크 경로와 다릅니다.`);
  }
  if (testCase.expectedLaw) {
    const match = lawReferences.find((reference) => reference.lawName === testCase.expectedLaw.lawName && reference.article === testCase.expectedLaw.article);
    assert(match, `${testCase.id}: ${testCase.expectedLaw.lawName} ${testCase.expectedLaw.article}가 없습니다.`);
    assert(match.text, `${testCase.id}: ${testCase.expectedLaw.article} 원문이 비어 있습니다.`);
    assert(match.link, `${testCase.id}: ${testCase.expectedLaw.article} 링크가 비어 있습니다.`);
  }
  assert(!/[?&]OC=/i.test(html), `${testCase.id}: HTML 링크에 OC가 노출됐습니다.`);
  assert(!/조회기준일|법령명\s*:/u.test(html), `${testCase.id}: 법령 메타텍스트가 노출됐습니다.`);

  return { selected: selectedSignature(result), itemCount: items.length };
}

const selectedCases = golden.cases.filter((testCase) => includeNatural || testCase.kind === "direct");
const skipped = golden.cases.length - selectedCases.length;
const results = [];
let failures = 0;

for (const testCase of selectedCases) {
  const runs = [];
  const started = Date.now();
  try {
    for (let index = 0; index < repeat; index += 1) {
      runs.push(validatePayload(testCase, await ask(testCase.query)));
    }
    const signatures = new Set(runs.map((run) => run.selected));
    results.push({ id: testCase.id, status: "PASS", runs: runs.length, consistent: signatures.size <= 1, elapsedMs: Date.now() - started });
  } catch (error) {
    failures += 1;
    results.push({ id: testCase.id, status: "FAIL", error: error.message, elapsedMs: Date.now() - started });
  }
}

console.log(JSON.stringify({
  suite: golden.version,
  mode,
  baseUrl,
  repeat,
  includeNatural,
  passed: results.filter((result) => result.status === "PASS").length,
  failed: failures,
  skipped,
  results,
}, null, 2));

if (failures > 0) process.exitCode = 1;
