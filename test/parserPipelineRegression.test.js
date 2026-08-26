import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mock } from "node:test";
import path from "node:path";
import test from "node:test";

const isChildFixtureRun = process.env.PARSER_PIPELINE_REGRESSION_CHILD === "1";
const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "..");

function runChildFixtureTest(testName) {
  const result = spawnSync(process.execPath, [
    "--experimental-test-module-mocks",
    "--test",
    "--test-name-pattern",
    testName,
    currentFile,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CASE_FINDER_SKIP_DOTENV: "1",
      PARSER_PIPELINE_REGRESSION_CHILD: "1",
    },
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error([
      `fixture child failed with status ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join("\n"));
  }
}

function installMcpFixture() {
  const mcpModule = pathToFileURL(path.join(repoRoot, "src", "mcpClient.js")).href;
  const calls = [];
  mock.module(mcpModule, {
    namedExports: {
      callTool: async (name, args = {}) => {
        calls.push({ name, args: { ...args } });
        if (name === "get_decision_text") {
          const fixtures = {
            "1001": [
              "사건번호: 2024다12345",
              "법원: 대법원",
              "선고일: 2024. 1. 1.",
              "판시사항:",
              "임금피크제의 합리적 이유 판단 기준",
              "판결요지:",
              "업무 내용과 부담 감소 여부 등을 종합하여 판단한다.",
              "참조조문:",
              "고용상 연령차별금지 및 고령자고용촉진에 관한 법률 제4조의4",
            ].join("\n"),
            "1002": [
              "사건번호: 2023다99999",
              "법원: 대법원",
              "선고일: 2024. 1. 1.",
              "판결요지:",
              "별도 판결요지만 존재한다.",
            ].join("\n"),
            "2001": [
              "사건번호: 2024다12345",
              "법원: 대법원",
              "선고일: 2024. 1. 1.",
              "판시사항:",
              "불법행위 손해배상 책임의 범위",
              "판결요지:",
              "고의 또는 과실과 손해 사이 인과관계를 판단한다.",
              "참조조문:",
              "민법 제750조",
            ].join("\n"),
          };
          return { rawText: fixtures[String(args.id)] || "[NOT_FOUND]" };
        }
        if (name === "search_law") {
          return {
            items: [{
              title: args.query,
              mst: args.query === "민법" ? "12345" : "67890",
              link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=12345",
            }],
          };
        }
        if (name === "get_law_text") return { rawText: `${args.jo}\n실제 provider 조문 내용` };
        throw new Error(`unexpected fixture tool: ${name}`);
      },
    },
  });
  return calls;
}

test("parsed precedent holding reaches Gemini candidate preview", async () => {
  if (!isChildFixtureRun) {
    runChildFixtureTest("parsed precedent holding reaches Gemini candidate preview");
    return;
  }

  installMcpFixture();
  const [{ config }, { prepareCandidates }] = await Promise.all([
    import("../config.js"),
    import("../src/nlPipeline.js"),
  ]);
  const { candidatesWithPreview } = await prepareCandidates([
    {
      id: "1001",
      caseNumber: "2024다12345",
      title: "임금피크제 판례",
      court: "대법원",
      date: "2024. 1. 1.",
      domain: "precedent",
      matchedKeywords: new Set(["임금피크제"]),
    },
    {
      id: "1002",
      caseNumber: "2023다99999",
      title: "판결요지만 있는 판례",
      court: "대법원",
      date: "2024. 1. 1.",
      domain: "precedent",
      matchedKeywords: new Set(["임금피크제"]),
    },
  ]);

  const withPreview = candidatesWithPreview.find((candidate) => candidate.id === "1001");
  const withoutPreview = candidatesWithPreview.find((candidate) => candidate.id === "1002");
  assert.ok(withPreview?.preview);
  assert.match(withPreview.preview, /임금피크제의 합리적 이유 판단 기준/u);
  assert.equal(withoutPreview?.preview, "");
  assert.equal(withPreview.score - withoutPreview.score, config.previewMissingPenalty);
});

test("parsed statute references reach direct lookup law enrichment", async () => {
  if (!isChildFixtureRun) {
    runChildFixtureTest("parsed statute references reach direct lookup law enrichment");
    return;
  }

  const calls = installMcpFixture();
  const { lookupDecisionCandidate } = await import("../src/directLookup.js");
  const item = await lookupDecisionCandidate({
    id: "2001",
    caseNumber: "2024다12345",
    title: "불법행위 손해배상 판례",
    court: "대법원",
    date: "2024. 1. 1.",
    domain: "precedent",
  });

  assert.equal(item.status, "verified");
  assert.match(item.detail.sections.참조조문, /민법 제750조/u);
  const reference = item.lawReferences.find((law) => law.lawName === "민법" && law.article === "제750조");
  assert.ok(reference);
  assert.ok(reference.text);
  assert.ok(reference.link);
  assert.deepEqual(calls.map((call) => call.name), ["get_decision_text", "search_law", "get_law_text"]);
  assert.equal(calls.find((call) => call.name === "search_law").args.query, "민법");
});

test("Luna law enrichment uses only detail-verified ledger cases", async () => {
  const [
    { createEvidenceLedger },
    { parseDecisionDetail },
    { buildLunaResultItems, enrichLunaRelatedLawReferences },
  ] = await Promise.all([
    import("../src/aoV2/evidenceLedger.js"),
    import("../src/legalMcpParser.js"),
    import("../src/searchAdapters/lunaNativeAdapter.js"),
  ]);

  const verifiedRawText = [
    "사건번호: 2024다10001",
    "판시사항:",
    "취업규칙 불이익 변경",
    "판결요지:",
    "근로자의 불이익 여부를 판단한다.",
    "참조조문:",
    "근로기준법 제94조",
  ].join("\n");
  const unverifiedRawText = [
    "사건번호: 2024다10002",
    "판시사항:",
    "불법행위 손해배상 책임",
    "참조조문:",
    "민법 제750조",
  ].join("\n");
  const ledger = createEvidenceLedger({ provider: "parser-pipeline-fixture" });
  ledger.recordDecisionSearch({
    query: "parser pipeline fixture",
    domain: "precedent",
    items: [
      { id: "d1", caseNumber: "2024다10001", title: "검증 판례" },
      { id: "d2", caseNumber: "2024다10002", title: "미검증 판례" },
    ],
  });
  const verifiedDetail = parseDecisionDetail(verifiedRawText);
  const unverifiedDetail = parseDecisionDetail(unverifiedRawText);
  const verifiedRecord = ledger.recordDecisionDetail({
    domain: "precedent",
    id: "d1",
    caseNumber: verifiedDetail.caseNumber,
    detail: verifiedDetail,
    rawText: verifiedRawText,
    verified: true,
  });
  const unverifiedRecord = ledger.recordDecisionDetail({
    domain: "precedent",
    id: "not-observed-d2",
    caseNumber: unverifiedDetail.caseNumber,
    detail: unverifiedDetail,
    rawText: unverifiedRawText,
    verified: true,
  });
  assert.equal(verifiedRecord.verified, true);
  assert.equal(unverifiedRecord.verified, false);

  const selectedItems = buildLunaResultItems({
    selected: [
      { case_no: "2024다10001", match: "direct" },
      { case_no: "2024다10002", match: "related" },
    ],
  }, ledger);
  assert.deepEqual(selectedItems.map((item) => item.caseNumber), ["2024다10001"]);

  const unverifiedCase = ledger.getCase("2024다10002");
  const gatewayCalls = [];
  const gateway = {
    async execute(name, args) {
      gatewayCalls.push({ name, args: { ...args } });
      if (name === "search_law") {
        return { items: [{ title: args.query, mst: "94000", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=94000" }] };
      }
      if (name === "get_law_text") return { rawText: `${args.jo}\n검증된 provider 조문 내용` };
      throw new Error(`unexpected gateway tool: ${name}`);
    },
  };
  const enriched = await enrichLunaRelatedLawReferences([
    selectedItems[0],
    {
      status: "validation_failed",
      caseNumber: unverifiedCase.caseNumber,
      detail: { sections: unverifiedCase.sections },
      lawReferences: [],
    },
  ], { gateway });

  const verifiedLaw = enriched.items[0].lawReferences.find((law) => law.lawName === "근로기준법" && law.article === "제94조");
  assert.ok(verifiedLaw);
  assert.ok(verifiedLaw.text);
  assert.ok(verifiedLaw.link);
  assert.equal(enriched.items[1].lawReferences.length, 0);
  assert.ok(enriched.lawReferences.some((law) => law.lawName === "근로기준법" && law.article === "제94조"));
  assert.equal(enriched.lawReferences.some((law) => law.lawName === "민법"), false);
  assert.equal(gatewayCalls.some((call) => JSON.stringify(call).includes("민법")), false);
});
