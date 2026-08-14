import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { adminSettingsView, validateAdminPatch, writeAdminSettings } from "../src/adminConfig.js";
import { createProgressReporter } from "../src/progress.js";
import { renderResults } from "../src/renderer.js";
import { validateDirectResult } from "../src/validator.js";

test("M10 progress is host-stage based and monotonic", () => {
  const events = [];
  const reporter = createProgressReporter((event) => events.push(event));
  reporter.emit("SEARCH_STARTED");
  reporter.emit("CANDIDATES_FOUND", { candidateCount: 4 });
  reporter.emit("ANALYSIS_COMPLETE");
  reporter.emit("DETAIL_VERIFIED", { candidateCount: 4, verifiedCount: 2 });
  reporter.emit("SEARCH_COMPLETE", { verifiedCount: 2 });
  assert.deepEqual(events.map((event) => event.event), ["SEARCH_STARTED", "CANDIDATES_FOUND", "DETAIL_VERIFIED", "SEARCH_COMPLETE"]);
  assert.equal(events[1].candidateCount, 4);
  assert.equal(events[2].verifiedCount, 2);
  assert.equal(Object.hasOwn(events[1], "query"), false);
  assert.equal(Object.hasOwn(events[1], "arguments"), false);
});

test("M10 admin settings accept whitelist only and never expose secret values", async () => {
  assert.deepEqual(validateAdminPatch({ SEARCH_ADAPTER: "luna_native", PORT: "3310" }), {
    SEARCH_ADAPTER: "luna_native",
    PORT: "3310",
  });
  assert.throws(() => validateAdminPatch({ CODEX_CLI_PATH: "C:\\secret\\codex.exe" }), /ADMIN_SETTING_NOT_ALLOWED/u);
  assert.throws(() => validateAdminPatch({ PORT: "0" }), /ADMIN_SETTING_INVALID:PORT/u);
  assert.equal(Object.hasOwn(adminSettingsView(), "lawOc"), false);
  assert.equal(Object.hasOwn(adminSettingsView().configured, "lawOcValue"), false);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "case-finder-m10-admin-"));
  const envPath = path.join(root, ".env");
  try {
    await fs.writeFile(envPath, "SEARCH_ADAPTER=gemini_d\n# keep this comment\n", "utf8");
    const written = await writeAdminSettings({ SEARCH_ADAPTER: "luna_native", PORT: "3310" }, envPath);
    assert.deepEqual(written, ["SEARCH_ADAPTER", "PORT"]);
    const text = await fs.readFile(envPath, "utf8");
    assert.match(text, /SEARCH_ADAPTER="luna_native"/u);
    assert.match(text, /PORT="3310"/u);
    assert.match(text, /# keep this comment/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("M10 renderer shows every verified item and collapsible provider law text", () => {
  const html = renderResults({
    query: "법률 질문",
    terminalState: "SUCCESS",
    intro: "provider 안내",
    items: [
      {
        status: "verified",
        caseNumber: "2020나1234",
        match: "direct",
        title: "첫 판례",
        detail: { sections: { 판시사항: "첫 판시사항", 판결요지: "첫 판결요지" } },
        link: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=1",
        lawReferences: [],
      },
      {
        status: "verified",
        caseNumber: "2021나5678",
        match: "related",
        title: "둘째 판례",
        detail: { sections: { 판시사항: "둘째 판시사항", 결정요지: "둘째 결정요지" } },
        link: "https://www.law.go.kr/LSW/precInfoP.do?precSeq=2",
        lawReferences: [],
      },
    ],
    lawReferences: [{ lawName: "민법", article: "제750조", text: "provider 조문 원문", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1" }],
  });
  assert.match(html, /2020나1234/u);
  assert.match(html, /2021나5678/u);
  assert.match(html, /<details class="law-details">/u);
  assert.match(html, /provider 조문 원문/u);
  assert.ok(html.indexOf("<h2>관련 법규</h2>") < html.indexOf("<h2>관련 판례</h2>"));
  assert.doesNotMatch(html, /chain-of-thought|tool arguments|LAW_OC/u);
});

test("M10 renderer keeps direct miss distinct from ordinary search failure", () => {
  const html = renderResults({ query: "2020다999999", route: "direct", terminalState: "NO_RESULT", items: [] });
  assert.match(html, /사건번호 조회 결과 없음/u);
  assert.match(html, /https:\/\/portal\.scourt\.go\.kr\/pgp\/index\.on\?m=PGP202M01&amp;l=Y&amp;c=400/u);
  assert.match(html, /판결서 인터넷열람/u);
  assert.match(html, /https:\/\/portal\.scourt\.go\.kr\/pgp\/index\.on\?m=PGP201M01A&amp;l=Y&amp;c=300/u);
  assert.match(html, /판결서사본 제공신청/u);
  assert.doesNotMatch(html, /SEARCH_FAILED/u);
});

test("M10 direct provider miss maps to NO_RESULT while verification failure stays distinct", async () => {
  const miss = await validateDirectResult({
    route: "direct",
    query: "2099다999999",
    items: [{ status: "not_found", caseNumber: "2099다999999" }],
  });
  assert.equal(miss.terminalState, "NO_RESULT");
  const failed = await validateDirectResult({
    route: "direct",
    query: "2020다1234",
    items: [{ status: "validation_failed", caseNumber: "2020다1234" }],
  });
  assert.equal(failed.terminalState, "SEARCH_FAILED");
});

test("M10 upstream direct lookup failure is not rendered as a not-found miss", async () => {
  const failed = await validateDirectResult({
    route: "direct",
    query: "2017다292343",
    items: [{ status: "search_failed", caseNumber: "2017다292343" }],
  });
  assert.equal(failed.terminalState, "SEARCH_FAILED");
  assert.notEqual(failed.terminalState, "NO_RESULT");
});
