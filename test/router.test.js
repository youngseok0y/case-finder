import assert from "node:assert/strict";
import test from "node:test";
import { extractCaseNumbers, parseCaseNumber, routeQuery } from "../src/router.js";

test("positive grammar accepts supported compact, spaced, hyphenated, prefixed, and historical identifiers", () => {
  for (const query of [
    "2024다12345",
    "2024 다 12345 판결",
    "2024-다-12345 판결 요지",
    "대법원-2024-다-12345 판결",
    "96헌마123 결정",
    "2035헌가9 결정",
  ]) {
    const route = routeQuery(query);
    assert.equal(route.kind, "direct", query);
    assert.equal(route.telemetry.route_reason, "valid_case_identifier", query);
    assert.ok(route.telemetry.candidate_case_code, query);
  }
  assert.deepEqual(parseCaseNumber("대법원-2024-다-12345"), {
    year: "2024",
    typeCode: "다",
    serial: "12345",
    caseNumber: "2024다12345",
  });
});

test("dates, statutes, quantities, and generic numbers stay natural", () => {
  const cases = [
    ["2015년 7월", "date_like_token"],
    ["2026년 1월 29일", "date_like_token"],
    ["2015-07-09", "date_like_token"],
    ["2015.07.09", "date_like_token"],
    ["제76조의5", "statute_like_token"],
    ["제11조 제2호", "statute_like_token"],
    ["제3조 제1항 제2호", "statute_like_token"],
    ["20여 개 죄명", "quantity_like_token"],
    ["3회 반복", "quantity_like_token"],
    ["100만원", "quantity_like_token"],
  ];
  for (const [query, reason] of cases) {
    const route = routeQuery(query);
    assert.equal(route.kind, "natural", query);
    assert.equal(route.cases.length, 0, query);
    assert.equal(route.telemetry.route_reason, reason, query);
    assert.deepEqual(extractCaseNumbers(query), [], query);
  }
});

test("related, exclusion, and multiple-identifier intent stays natural", () => {
  for (const query of [
    "2024다12345와 유사한 판례 찾아줘",
    "2024다12345와 같은 쟁점의 다른 판례",
    "2024다12345 말고 다른 판례",
    "2024다12345를 제외하고 찾아줘",
    "2024다12345와 2023도54321을 비교해줘",
  ]) {
    const route = routeQuery(query);
    assert.equal(route.kind, "natural", query);
    assert.equal(route.cases.length, 0, query);
    assert.ok(["related_search_intent", "exclusion_intent", "multiple_identifiers"].includes(route.telemetry.route_reason), query);
  }
  assert.equal(routeQuery("2024다12345 관련 내용을 알려줘").kind, "direct");
});
