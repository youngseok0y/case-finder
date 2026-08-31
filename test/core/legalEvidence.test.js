// Consolidated from test/legalMcpParser.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { parseDecisionDetail, parseLawArticleIdentity } = await import("../../src/legalMcpParser.js");
  test("parseDecisionDetail restores Korean precedent sections and metadata", () => {
    const detail = parseDecisionDetail([
      "사건번호: 2024다12345",
      "법원: 대법원",
      "선고일: 2024. 1. 1.",
      "사건종류: 민사",
      "판결유형: 판결",
      "판시사항:",
      "임대차계약의 해지와 손해배상 범위가 쟁점이다.",
      "판결요지:",
      "계약 해지의 요건과 손해의 범위를 함께 판단한다.",
      "참조조문:",
      "민법 제750조",
      "참조판례:",
      "대법원 2020다12345",
      "이유:",
      "이 사건 기록과 관련 법리를 종합한다.",
    ].join("\n"));

    assert.equal(detail.caseNumber, "2024다12345");
    assert.equal(detail.court, "대법원");
    assert.equal(detail.date, "2024. 1. 1.");
    assert.equal(detail.caseType, "민사");
    assert.equal(detail.type, "판결");
    assert.deepEqual(detail.sections, {
      판시사항: "임대차계약의 해지와 손해배상 범위가 쟁점이다.",
      판결요지: "계약 해지의 요건과 손해의 범위를 함께 판단한다.",
      참조조문: "민법 제750조",
      참조판례: "대법원 2020다12345",
      이유: "이 사건 기록과 관련 법리를 종합한다.",
    });
  });

  test("parseDecisionDetail decodes HTML line breaks before section parsing", () => {
    const detail = parseDecisionDetail([
      "사건번호: 2024헌나8",
      "판시사항:<br>헌법상 쟁점 &amp; 심사 기준",
      "결정요지:<br>청구는 이유 없다.",
    ].join("\r\n"));

    assert.equal(detail.caseNumber, "2024헌나8");
    assert.equal(detail.sections.판시사항, "헌법상 쟁점 & 심사 기준");
    assert.equal(detail.sections.결정요지, "청구는 이유 없다.");
  });
})();

// Consolidated from test/lawReferences.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const test = (await import("node:test")).default;
  const { articleToJoNo, enrichLawReferences, lawDetailLink, parseStatuteReferences } = await import("../../src/directLookup.js");
  const { parseLawArticleIdentity } = await import("../../src/legalMcpParser.js");
  const { dedupeLawReferences } = await import("../../src/lawReferences.js");
  const { renderResults } = await import("../../src/renderer.js");
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

  test("law references preserve quoted names and normalize the constitutional alias", () => {
    assert.deepEqual(pairs("「민법」 제750조, 『대한민국헌법』 제10조"), [
      ["민법", "제750조"],
      ["대한민국헌법", "제10조"],
    ]);
  });

  test("law article identity rejects empty, ambiguous, and mismatched provider text", async () => {
    assert.deepEqual(parseLawArticleIdentity("제750조(불법행위의 내용)\n실제 조문"), {
      article: "제750조",
      articles: ["제750조"],
      identifiable: true,
      ambiguous: false,
    });
    assert.deepEqual(parseLawArticleIdentity("법령명: 민법\n설명만 있음"), {
      article: "",
      articles: [],
      identifiable: false,
      ambiguous: false,
    });

    const execute = async (name, args) => {
      if (name === "search_law") return { items: [{ title: args.query, mst: "284415" }] };
      return { rawText: "제750조(불법행위의 내용)\n실제 조문" };
    };
    assert.deepEqual(await enrichLawReferences("민법 제756조", null, execute), []);
    assert.deepEqual(await enrichLawReferences("민법 제756조", null, async (name, args) => {
      if (name === "search_law") return { items: [{ title: args.query, mst: "284415" }] };
      return { rawText: "제750조\n제751조" };
    }), []);
    assert.equal((await enrichLawReferences("민법 제756조", null, async (name, args) => {
      if (name === "search_law") return { items: [{ title: args.query, mst: "284415" }] };
      return { rawText: "제756조(손해배상)\n실제 조문" };
    })).length, 1);
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

  test("enrichLawReferences shares duplicate work and caps provider concurrency at two", async () => {
    const cache = new Map();
    const calls = [];
    let active = 0;
    let maximumActive = 0;
    const executeTool = async (name, args) => {
      calls.push({ name, args });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      if (name === "search_law") return { items: [{ title: args.query, mst: args.query === "민법" ? "1" : args.query === "형법" ? "2" : "3" }] };
      return { rawText: `${args.jo}\n실제 provider 조문 내용` };
    };

    const [first, second] = await Promise.all([
      enrichLawReferences("민법 제1조, 형법 제2조, 상법 제3조", null, executeTool, { lawReferenceCache: cache }),
      enrichLawReferences("민법 제1조", null, executeTool, { lawReferenceCache: cache }),
    ]);
    assert.equal(first.length, 3);
    assert.equal(second.length, 1);
    assert.equal(calls.filter(({ name, args }) => name === "search_law" && args.query === "민법").length, 1);
    assert.equal(calls.filter(({ name }) => name === "search_law").length, 3);
    assert.equal(calls.filter(({ name }) => name === "get_law_text").length, 3);
    assert.ok(maximumActive <= 2);
  });

  test("enrichLawReferences prefers the observed lawId for current MCP law details", async () => {
    const calls = [];
    const executeTool = async (name, args) => {
      calls.push({ name, args });
      if (name === "search_law") return {
        items: [{ title: args.query, lawId: "001706", mst: "284415" }],
      };
      assert.deepEqual(args, { lawId: "001706", jo: "제1조" });
      return { rawText: "제1조\n실제 provider 조문 내용" };
    };

    const enriched = await enrichLawReferences("민법 제1조", null, executeTool);
    assert.equal(enriched.length, 1);
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

  test("canonical law references normalize identity and retain only renderable links", () => {
    const references = dedupeLawReferences([
      { lawName: " 민법 ", article: " 제750조 ", link: " https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1 " },
      { lawName: "민법", article: "제750조", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1" },
      { lawName: "대한민국헌법", article: "제10조", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=2" },
      { lawName: "헌법", article: "제10조", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=2" },
      { lawName: "민법", article: "제751조", link: "" },
      { lawName: "", article: "제750조", link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1" },
    ]);
    assert.deepEqual(references.map(({ lawName, article, link }) => ({ lawName, article, link })), [
      {
        lawName: "민법",
        article: "제750조",
        link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=1",
      },
      {
        lawName: "대한민국헌법",
        article: "제10조",
        link: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=2",
      },
    ]);
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
})();

// Consolidated from test/parserPipelineRegression.test.js.
await (async () => {
  const assert = (await import("node:assert/strict")).default;
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const { mock } = await import("node:test");
  const path = (await import("node:path")).default;
  const test = (await import("node:test")).default;
  const isChildFixtureRun = process.env.PARSER_PIPELINE_REGRESSION_CHILD === "1";
  const currentFile = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(currentFile), "../..");

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
      import("../../config.js"),
      import("../../src/nlPipeline.js"),
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
    const { lookupDecisionCandidate } = await import("../../src/directLookup.js");
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
      import("../../src/aoV2/evidenceLedger.js"),
      import("../../src/legalMcpParser.js"),
      import("../../src/searchAdapters/lunaNativeAdapter.js"),
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
})();
