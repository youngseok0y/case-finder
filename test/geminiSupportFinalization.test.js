import assert from "node:assert/strict";
import test from "node:test";

import { createLunaNativeAdapter } from "../src/searchAdapters/lunaNativeAdapter.js";
import { toResultContract } from "../src/searchAdapters/resultContract.js";
import { finalizeSelection } from "../src/nlPipeline.js";
import { validateNaturalResult } from "../src/validator.js";

const RESULT_METADATA = {
  adapterId: "gemini_d",
  provider: "gemini",
  architecture: "D",
};

const RELATED_INTRO = "질문과 직접 동일한 쟁점을 다룬 판례로 확인되지는 않았지만, 관련 법리를 참고할 수 있는 판례가 있습니다.";
const NO_RESULT_WITH_LAWS_INTRO = "현재 검색 결과에서는 질문을 직접 뒷받침하는 판례를 확인하지 못했습니다. 관련 법령은 아래에서 확인할 수 있습니다.";
const NO_RESULT_INTRO = "현재 검색 결과에서는 질문을 직접 뒷받침하는 판례를 확인하지 못했습니다.";

function contentResult(text, isError = false) {
  return { isError, content: [{ type: "text", text }] };
}

function detailText(caseNumber) {
  return [
    `사건번호: ${caseNumber}`,
    "법원: 대법원",
    "선고일: 2024. 1. 1.",
    "판시사항: provider-verified fixture",
  ].join("\n");
}

function candidate(caseNumber, id = caseNumber) {
  return {
    id,
    caseNumber,
    title: "support fixture",
    court: "대법원",
    date: "2024. 1. 1.",
    domain: "precedent",
    preview: "provider preview",
  };
}

async function finalize(selection, options = {}) {
  const candidates = options.candidates || [candidate("2024다00001"), candidate("2024다00002")];
  const failedIds = new Set(options.failedIds || []);
  const caseById = new Map(candidates.map((item) => [item.id, item.caseNumber]));
  const internal = await finalizeSelection({
    query: "support fixture",
    candidatesWithPreview: candidates,
    candidatePool: candidates,
    selection,
    fallbackLabel: "",
    lawReferences: options.lawReferences || [],
    searchFailed: options.searchFailed === true,
    telemetry: {
      executeTool: async (name, args) => {
        assert.equal(name, "get_decision_text");
        if (failedIds.has(args.id)) return contentResult("[NOT_FOUND]", true);
        return contentResult(detailText(caseById.get(args.id) || args.id));
      },
    },
  });
  const contract = toResultContract(internal, RESULT_METADATA);
  const validated = await validateNaturalResult(contract);
  return { internal, contract, validated };
}

test("B1 direct support keeps the existing verified success shape", async () => {
  const { internal, validated } = await finalize({
    support: "direct",
    selected: [{ case_no: "2024다00001", match: "direct" }],
    intro: "직접 관련 판례입니다.",
  });

  assert.equal(internal.support, "direct");
  assert.equal(validated.terminalState, "SUCCESS");
  assert.deepEqual(validated.selected, [{ caseNumber: "2024다00001", match: "direct" }]);
  assert.equal(Object.hasOwn(validated, "support"), false);
});

test("B2 related_only keeps verified cases as related and uses the safe intro", async () => {
  const { internal, validated } = await finalize({
    support: "related_only",
    selected: [{ case_no: "2024다00001", match: "direct" }],
    intro: "직접 동일한 사건입니다.",
  });

  assert.equal(internal.support, "related_only");
  assert.equal(internal.intro, RELATED_INTRO);
  assert.equal(validated.terminalState, "SUCCESS");
  assert.deepEqual(validated.selected, [{ caseNumber: "2024다00001", match: "related" }]);
  assert.ok(validated.items.every((item) => item.match === "related"));
});

test("B3 conflicting selector intro is replaced for related-only support", async () => {
  const { validated } = await finalize({
    support: "related_only",
    selected: [{ case_no: "2024다00001", match: "related" }],
    intro: "질문과 직접 동일한 쟁점의 판례입니다.",
  });

  assert.equal(validated.intro, RELATED_INTRO);
  assert.doesNotMatch(validated.intro, /직접 동일한 쟁점의 판례/u);
});

test("B4 none keeps verified law references with a bounded no-result intro", async () => {
  const lawReferences = [{ lawName: "민법", article: "제750조", text: "provider law text", link: "https://www.law.go.kr/" }];
  const { contract, validated } = await finalize({
    support: "none",
    selected: [{ case_no: "2024다00001", match: "direct" }],
    intro: "법적 근거가 없습니다.",
  }, { lawReferences });

  assert.equal(contract.terminalState, "NO_RESULT");
  assert.deepEqual(validated.lawReferences, lawReferences);
  assert.equal(validated.intro, NO_RESULT_WITH_LAWS_INTRO);
  assert.deepEqual(validated.selected, []);
  assert.deepEqual(validated.items, []);
});

test("B5 none without law references remains a safe completed negative", async () => {
  const { validated } = await finalize({ support: "none", selected: [], intro: "법적 근거가 없습니다." });

  assert.equal(validated.terminalState, "NO_RESULT");
  assert.equal(validated.intro, NO_RESULT_INTRO);
  assert.deepEqual(validated.selected, []);
  assert.deepEqual(validated.items, []);
});

test("B6 search failure is not laundered into NO_RESULT", async () => {
  const { contract, validated } = await finalize({ support: "none", selected: [], intro: "" }, { searchFailed: true });

  assert.equal(contract.terminalState, "SEARCH_FAILED");
  assert.equal(validated.terminalState, "SEARCH_FAILED");
  assert.equal(validated.intro, "");
});

test("B7 a failed direct item with a verified related item downgrades effective support", async () => {
  const candidates = [candidate("2024다00001", "direct-id"), candidate("2024다00002", "related-id")];
  const { internal, validated } = await finalize({
    support: "direct",
    selected: [
      { case_no: "2024다00001", match: "direct" },
      { case_no: "2024다00002", match: "related" },
    ],
    intro: "직접 관련 판례입니다.",
  }, { candidates, failedIds: ["direct-id"] });

  assert.equal(internal.support, "related_only");
  assert.equal(internal.intro, RELATED_INTRO);
  assert.deepEqual(validated.selected, [{ caseNumber: "2024다00002", match: "related" }]);
  assert.equal(validated.items.every((item) => item.match === "related"), true);
});

test("B8 when the gate removes every selected item, effective support is none", async () => {
  const { internal, validated } = await finalize({
    support: "direct",
    selected: [{ case_no: "2024다00001", match: "direct" }],
    intro: "직접 관련 판례입니다.",
  }, { failedIds: ["2024다00001"] });

  assert.equal(internal.support, "none");
  assert.deepEqual(validated.selected, []);
  assert.deepEqual(validated.items, []);
  assert.equal(validated.terminalState, "SEARCH_FAILED");
});

test("B9 support remains internal and is absent from the public contract", async () => {
  const { contract } = await finalize({ support: "none", selected: [], intro: "" });

  assert.equal(Object.hasOwn(contract, "support"), false);
  assert.equal(Object.hasOwn(contract, "selection"), false);
});

test("B11 Luna Native result contract remains unchanged", async () => {
  const luna = createLunaNativeAdapter({
    run: async () => ({ selected: [], items: [], candidateCaseNumbers: [], lawReferences: [] }),
  });
  const result = await luna.runNaturalQuery("luna fixture");

  assert.equal(Object.hasOwn(result, "support"), false);
  assert.equal(result.terminalState, "NO_RESULT");
});
