import fs from "node:fs";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { finalizeSelection } from "../src/aoV2/finalSelectionGate.js";

const REPLAY_QUESTIONS = Object.freeze([
  { id: "related-platform-union-worker", planIndex: 5, expected: "2014두12598", expectedOldSelected: [] },
  { id: "statute-trade-union-worker-2", planIndex: 9, expected: "2014두12598", expectedOldSelected: [{ case_no: "2014두12598", match: "direct" }] },
]);

function readJsonLines(path) {
  return fs.readFileSync(path, "utf8").split(String.fromCharCode(10)).filter(Boolean).map((line) => JSON.parse(line));
}

function replayTrace(trace) {
  const ledger = createEvidenceLedger({ provider: "m9_offline_replay" });
  for (const event of trace) {
    if (event.name === "search_decisions") {
      ledger.recordDecisionSearch({
        domain: event.args?.domain,
        query: event.args?.query,
        items: event.result?.items || [],
      });
    }
    if (event.name === "get_decision_text") {
      ledger.recordDecisionDetail({
        domain: event.args?.domain,
        id: event.args?.id,
        caseNumber: event.result?.caseNumber,
        rawText: event.result?.rawText || "recorded provider detail succeeded",
        detail: event.result || {},
      });
    }
  }
  return ledger;
}

export function runSyntheticCompoundReplay() {
  const ledger = createEvidenceLedger({ provider: "m9_synthetic_replay" });
  ledger.recordDecisionSearch({
    domain: "precedent",
    query: "compound fixture",
    items: [{ id: "compound-1", caseNumber: "2014두12598" }],
  });
  ledger.recordDecisionDetail({
    domain: "precedent",
    id: "compound-1",
    caseNumber: "2014두12598, 12604",
    rawText: "provider raw detail",
  });
  const recovered = finalizeSelection({ intro: "", selected: [{ case_no: "2014두12598", match: "direct" }] }, ledger);
  const rejected = finalizeSelection({ intro: "", selected: [{ case_no: "2014두99999", match: "direct" }] }, ledger);
  if (recovered.selected.length !== 1 || rejected.rejectedSelected[0]?.reason !== "CASE_NOT_OBSERVED") {
    throw new Error("M9_COMPOUND_REPLAY_ASSERTION_FAILED");
  }
  return { recovered: recovered.selected[0].case_no, inventedSibling: rejected.rejectedSelected[0].reason };
}

export function runRecordedCompoundReplay({ recordsPath, finalsDirectory } = {}) {
  const records = readJsonLines(recordsPath);
  const outcomes = [];
  for (const question of REPLAY_QUESTIONS) {
    const record = records.find((candidate) => candidate.question_id === question.id);
    if (!record) throw new Error(`M9_REPLAY_RECORD_MISSING:${question.id}`);
    const finalPath = `${finalsDirectory}/final-${question.planIndex}.json`;
    const oldFinal = JSON.parse(fs.readFileSync(finalPath, "utf8"));
    const ledger = replayTrace(record.gateway_trace || []);
    const gated = finalizeSelection(oldFinal, ledger);
    const recovered = gated.selected.some((item) => item.case_no === question.expected);
    outcomes.push({
      question_id: question.id,
      old_selected: question.expectedOldSelected,
      replay_selected: gated.selected,
      recovered,
      rejected_selected: gated.rejectedSelected,
      observed_compound: ledger.snapshot().cases
        .flatMap((candidate) => candidate.rawCaseNumbers.filter((raw) => raw.includes(","))),
    });
    if (!recovered) throw new Error(`M9_REPLAY_DID_NOT_RECOVER:${question.id}`);
  }
  return { target_count: outcomes.length, recovered_count: outcomes.filter((outcome) => outcome.recovered).length, outcomes };
}

if (process.argv.includes("--recorded")) {
  const base = "test/private/m8-golden17-live-final-luna/luna";
  console.log(JSON.stringify(runRecordedCompoundReplay({
    recordsPath: `${base}/golden17-records.jsonl`,
    finalsDirectory: base,
  }), null, 2));
} else if (process.argv.includes("--synthetic")) {
  console.log(JSON.stringify(runSyntheticCompoundReplay(), null, 2));
}
