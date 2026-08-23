import { logValidation } from "./log.js";
import { normalizeLawArticle, sanitizeEvidenceNarrative } from "./aoV2/finalSelectionGate.js";
import { deriveTerminalState } from "./searchAdapters/resultContract.js";
import { SAFETY_REJECTED_MESSAGE } from "./productMessages.js";
import {
  caseNumberKey,
  caseNumberMatches,
  caseNumberIncludes,
  normalizeCaseNumber,
} from "./router.js";

export async function validateDirectResult(result) {
  const validItems = [];
  const failures = [];
  const requested = result.requestedCaseNumbers || [];

  for (const item of result.items || []) {
    let reason = "";
    if (item.status !== "verified") reason = `조회 상태가 ${item.status}입니다.`;
    else if (!requested.some((value) => caseNumberIncludes(item.caseNumber, value))) reason = "요청된 사건번호 목록 밖의 항목입니다.";
    else if (!(item.candidateCaseNumbers || []).some((value) => caseNumberMatches(value, item.caseNumber))) {
      reason = "후보 목록에 정확히 일치하는 사건번호가 없습니다.";
    } else if (!caseNumberMatches(item.detail?.caseNumber, item.caseNumber)) {
      reason = "전문 조회 사건번호가 요청값과 일치하지 않습니다.";
    } else if (!item.detail?.rawText) {
      reason = "전문 조회 원문이 비어 있습니다.";
    }

    if (reason) {
      failures.push({ caseNumber: item.caseNumber, reason });
      await logValidation(result.query, item.caseNumber, reason);
    } else {
      validItems.push(item);
    }
  }

  const directMiss = (result.items || []).length > 0
    && (result.items || []).every((item) => item.status === "not_found")
    && validItems.length === 0;
  return {
    ...result,
    items: validItems,
    validationFailures: failures,
    terminalState: directMiss
      ? "NO_RESULT"
      : deriveTerminalState({ ...result, validationFailures: failures }, true, validItems),
  };
}

export async function validateNaturalResult(result) {
  if (result.outputValid === false) {
    return {
      ...result,
      selected: [],
      items: [],
      terminalState: "SAFETY_REJECTED",
      validationFailures: result.validationFailures || [],
      fallbackLabel: SAFETY_REJECTED_MESSAGE,
    };
  }
  const candidateNumbers = result.candidateCaseNumbers || [];
  const validItems = [];
  const validSelections = [];
  const failures = [];
  const seen = new Set();
  for (const selection of result.selected || []) {
    const caseNumber = normalizeCaseNumber(selection.caseNumber);
    const item = (result.items || []).find((candidate) => caseNumberMatches(candidate.caseNumber, caseNumber));
    let reason = "";
    if (!candidateNumbers.some((value) => caseNumberMatches(value, caseNumber))) reason = "후보 목록 밖의 사건번호입니다.";
    else if (selection.match !== "direct" && selection.match !== "related") reason = "선별 결과의 match 값이 올바르지 않습니다.";
    else if (!item || item.status !== "verified") reason = "상세 조회에 성공하지 못한 사건번호입니다.";
    else if (!caseNumberMatches(item.detail?.caseNumber, caseNumber)) reason = "전문 조회 사건번호가 후보값과 일치하지 않습니다.";
    else if (!item.detail?.rawText) reason = "전문 조회 원문이 비어 있습니다.";
    else if (seen.has(caseNumberKey(caseNumber))) reason = "중복 사건번호가 선별되었습니다.";

    if (reason) {
      failures.push({ caseNumber, reason });
      await logValidation(result.query, caseNumber, reason);
      continue;
    }
    seen.add(caseNumberKey(caseNumber));
    validSelections.push({ caseNumber, match: selection.match });
    validItems.push({ ...item, match: selection.match });
  }

  const narrative = sanitizeEvidenceNarrative(result.intro, {
    isCaseVerified: (caseNumber) => validItems.some((item) =>
      item.status === "verified"
      && caseNumberMatches(item.caseNumber, caseNumber)
      && Boolean(item.detail?.rawText),
    ),
    isLawArticleOpened: (article) => {
      const normalizedArticle = normalizeLawArticle(article);
      return (result.lawReferences || []).some((reference) =>
        normalizeLawArticle(reference?.article) === normalizedArticle
        && Boolean(reference?.lawName)
        && Boolean(reference?.text),
      );
    },
  });
  for (const diagnostic of narrative.diagnostics) {
    await logValidation(result.query, "(intro)", diagnostic.code);
  }
  const protocolDiagnostics = [
    ...(Array.isArray(result.protocolDiagnostics) ? result.protocolDiagnostics : []),
    ...narrative.diagnostics,
  ];
  return {
    ...result,
    intro: narrative.text,
    selected: validSelections,
    items: validItems,
    validationFailures: failures,
    protocolDiagnostics,
    selectionRepaired: Boolean(result.selectionRepaired || narrative.sanitized),
    terminalState: deriveTerminalState({ ...result, validationFailures: failures }, result.outputValid !== false, validItems),
  };
}
