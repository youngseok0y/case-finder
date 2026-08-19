import assert from "node:assert/strict";
import test from "node:test";
import { articleToJoNo, enrichLawReferences, lawDetailLink, parseStatuteReferences } from "../src/directLookup.js";
import { renderResults } from "../src/renderer.js";

function pairs(value) {
  return parseStatuteReferences(value).map(({ lawName, article }) => [lawName, article]);
}

test("parseStatuteReferences carries law context across article lists and switches laws left-to-right", () => {
  assert.deepEqual(pairs("민법 제393조, 제750조, 제763조"), [
    ["민법", "제393조"],
    ["민법", "제750조"],
    ["민법", "제763조"],
  ]);
  assert.deepEqual(pairs("헌법 제10조, 제17조, 민법 제756조"), [
    ["헌법", "제10조"],
    ["헌법", "제17조"],
    ["민법", "제756조"],
  ]);
  assert.deepEqual(pairs("헌법 제10조, 제17조,\n남녀고용평등과 일·가정 양립 지원에 관한 법률 제14조,\n민법 제756조"), [
    ["헌법", "제10조"],
    ["헌법", "제17조"],
    ["남녀고용평등과 일·가정 양립 지원에 관한 법률", "제14조"],
    ["민법", "제756조"],
  ]);
  assert.deepEqual(pairs("민법 시행령 제1조; 민법 시행규칙 제2조; 회사 규칙 제3조"), [
    ["민법 시행령", "제1조"],
    ["민법 시행규칙", "제2조"],
    ["회사 규칙", "제3조"],
  ]);
});

test("parseStatuteReferences preserves branch articles and removes duplicate pairs", () => {
  assert.deepEqual(pairs("민법 제10조의2, 제10조의3, 제10조의2"), [
    ["민법", "제10조의2"],
    ["민법", "제10조의3"],
  ]);
  assert.deepEqual(pairs("형법 제250조 / 형법 제250조"), [["형법", "제250조"]]);
});

test("articleToJoNo converts article and branch numbers and ignores invalid input", () => {
  assert.equal(articleToJoNo("제1조"), "000100");
  assert.equal(articleToJoNo("제10조"), "001000");
  assert.equal(articleToJoNo("제10조의2"), "001002");
  assert.equal(articleToJoNo("제22조"), "002200");
  assert.equal(articleToJoNo("제756조"), "075600");
  assert.equal(articleToJoNo("제10조제1항"), "001000");
  assert.equal(articleToJoNo("제10조의2제3항"), "001002");
  assert.equal(articleToJoNo("invalid"), "");
});

test("lawDetailLink creates an article deeplink and safely falls back to the law page", () => {
  const articleLink = new URL(lawDetailLink("61603", "제10조제1항"));
  assert.equal(articleLink.pathname, "/LSW/lsInfoP.do");
  assert.equal(articleLink.searchParams.get("lsiSeq"), "61603");
  assert.equal(articleLink.searchParams.get("docType"), "JO");
  assert.equal(articleLink.searchParams.get("joNo"), "001000");

  const fallbackLink = new URL(lawDetailLink("61603", "invalid"));
  assert.equal(fallbackLink.searchParams.get("lsiSeq"), "61603");
  assert.equal(fallbackLink.searchParams.has("docType"), false);
  assert.equal(fallbackLink.searchParams.has("joNo"), false);
});

test("enrichLawReferences keeps only provider-verified references and uses the article deeplink", async () => {
  const calls = [];
  const executeTool = async (name, args) => {
    calls.push({ name, args });
    if (name === "search_law") return { items: [{ title: args.query, mst: "284415", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=284415" }] };
    return { rawText: `${args.jo}\n실제 조문 내용` };
  };

  const enriched = await enrichLawReferences("민법 제756조", null, executeTool);
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].lawName, "민법");
  assert.equal(enriched[0].article, "제756조");
  assert.equal(enriched[0].text, "제756조\n실제 조문 내용");
  const link = new URL(enriched[0].link);
  assert.equal(link.searchParams.get("docType"), "JO");
  assert.equal(link.searchParams.get("joNo"), "075600");
  assert.deepEqual(calls.map((call) => call.name), ["search_law", "get_law_text"]);
});

test("enrichLawReferences drops NOT_FOUND and error references instead of returning blank UI links", async () => {
  const notFound = await enrichLawReferences("민법 제756조", null, async (name) => {
    if (name === "search_law") return { items: [{ title: "민법", mst: "284415" }] };
    return { rawText: "[NOT_FOUND]" };
  });
  assert.deepEqual(notFound, []);

  const errored = await enrichLawReferences("민법 제756조", null, async (name) => {
    if (name === "search_law") return { items: [{ title: "민법", mst: "284415" }] };
    return { isError: true, rawText: "provider error" };
  });
  assert.deepEqual(errored, []);
});

test("renderer preserves law article deeplink query parameters and opens it in a new tab", () => {
  const html = renderResults({
    terminalState: "SUCCESS",
    query: "법령 참조",
    items: [],
    lawReferences: [{
      lawName: "헌법",
      article: "제10조",
      text: "모든 국민은 인간으로서의 존엄과 가치를 가진다.",
      link: lawDetailLink("61603", "제10조"),
    }],
  });
  assert.match(html, /target="_blank"/u);
  assert.match(html, /\/LSW\/lsInfoP\.do\?lsiSeq=61603&amp;docType=JO&amp;joNo=001000/u);
});

test("2016다202947 reference shape does not cross-assign 민법 to 헌법", () => {
  const referenceText = "헌법 제10조, 제17조, 남녀고용평등과 일·가정 양립 지원에 관한 법률 제14조, 민법 제756조";
  const parsed = pairs(referenceText);
  assert.equal(parsed.some(([lawName, article]) => lawName === "헌법" && article === "제756조"), false);
  assert.equal(parsed.some(([lawName, article]) => lawName === "민법" && article === "제756조"), true);
});
