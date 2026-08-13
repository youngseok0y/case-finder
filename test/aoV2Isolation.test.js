import assert from "node:assert/strict";
import test from "node:test";
import { createAgenticSearchV2 } from "../src/aoV2/index.js";

test("AO-v2 resets ledger and observed-id scope for every question", async () => {
  let sessionCount = 0;
  const sessions = [
    [
      { type: "tool_call", call_id: "a-search", name: "search_decisions", arguments: { domain: "precedent", query: "질문 A" } },
      { type: "tool_call", call_id: "a-detail", name: "get_decision_text", arguments: { domain: "precedent", id: "a1" } },
      { type: "final", selection: { selected: [{ case_no: "2020다1234", match: "direct" }], intro: "" } },
    ],
    [
      { type: "tool_call", call_id: "b-detail", name: "get_decision_text", arguments: { domain: "precedent", id: "a1" } },
      { type: "final", selection: { selected: [], intro: "" } },
    ],
  ];
  const runtime = createAgenticSearchV2({
    provider: "codex_luna",
    adapterOptions: {
      createSession: async () => {
        const events = sessions[sessionCount++];
        return {
          sessionId: `session-${sessionCount}`,
          async next() { return events.shift(); },
          async respondToToolCall() {},
          async close() {},
        };
      },
    },
    gatewayOptions: {
      callTool: async () => ({}),
      normalizeResult: async (name) => name === "search_decisions"
        ? { isError: false, items: [{ id: "a1", caseNumber: "2020다1234" }], rawText: "search" }
        : { isError: false, caseNumber: "2020다1234", rawText: "detail", sections: {} },
    },
  });

  const first = await runtime.runAgenticSearchV2("질문 A");
  const second = await runtime.runAgenticSearchV2("질문 B");

  assert.notEqual(first.telemetry.question_scope_id, second.telemetry.question_scope_id);
  assert.equal(first.telemetry.session_id, "session-1");
  assert.equal(second.telemetry.session_id, "session-2");
  assert.equal(first.ledger.cases.length, 1);
  assert.equal(second.ledger.cases.length, 0);
  assert.equal(second.telemetry.observed_cases, 0);
  assert.equal(second.telemetry.verified_cases, 0);
  assert.equal(second.telemetry.tool_errors, 1);
  assert.equal(second.selected.length, 0);
});
