import assert from "node:assert/strict";
import test from "node:test";
import { parseDecisionDetail } from "../src/legalMcpParser.js";

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
