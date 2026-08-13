import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { CODEX_NATIVE_ALLOWED_TOOLS, createCodexNativeAo } from "../src/aoV2/providers/codexNativeAo.js";
import { createLegalToolGateway } from "../src/aoV2/legalToolGateway.js";
import { createSafetyController } from "../src/aoV2/safety.js";
import { createTelemetry } from "../src/aoV2/telemetry.js";

function makeGateway() {
  const ledger = createEvidenceLedger({ provider: "codex_luna" });
  const telemetry = createTelemetry({ provider: "codex_luna", model: "fixture", reasoningEffort: "medium" });
  const gateway = createLegalToolGateway({
    ledger,
    telemetry,
    safety: createSafetyController({ legalToolMax: 10 }),
    callTool: async () => ({}),
    normalizeResult: async (name) => name === "search_decisions"
      ? { isError: false, items: [{ id: "d1", caseNumber: "2020다1234" }], rawText: "search" }
      : { isError: false, caseNumber: "2020다1234", rawText: "detail", sections: {} },
  });
  return { ledger, telemetry, gateway };
}

test("Codex native adapter owns one persistent session and uses restricted legal tools", async () => {
  const { ledger, telemetry, gateway } = makeGateway();
  let created = 0;
  const responses = [];
  const session = {
    sessionId: "session-1",
    async next() {
      return responses.shift();
    },
    async respondToToolCall(value) {
      this.responses ||= [];
      this.responses.push(value);
    },
    async close() {
      this.closed = true;
    },
  };
  responses.push(
    { type: "tool_call", call_id: "s1", name: "search_decisions", arguments: { domain: "precedent", query: "계약" } },
    { type: "tool_call", call_id: "d1", name: "get_decision_text", arguments: { domain: "precedent", id: "d1" } },
    { type: "final", selection: { selected: [{ case_no: "2020다1234", match: "direct" }], intro: "설명" } },
  );
  const adapter = createCodexNativeAo({
    gateway,
    ledger,
    telemetry,
    createSession: async (options) => {
      created += 1;
      assert.deepEqual(options.tools.map((tool) => tool.name), CODEX_NATIVE_ALLOWED_TOOLS);
      assert.doesNotMatch(options.prompt, /conversation_state|M7R|gold/u);
      return session;
    },
  });
  const result = await adapter.run("계약 질문");
  assert.equal(created, 1);
  assert.deepEqual(result.selected, [{ case_no: "2020다1234", match: "direct" }]);
  assert.equal(result.telemetry.session_id, "session-1");
  assert.equal(session.responses.length, 2);
  assert.equal(session.closed, true);
});

test("Codex native adapter invalidates forbidden tool contamination", async () => {
  const { ledger, telemetry, gateway } = makeGateway();
  let closed = false;
  const adapter = createCodexNativeAo({
    gateway,
    ledger,
    telemetry,
    createSession: async () => ({
      sessionId: "session-2",
      async next() { return { type: "command_execution" }; },
      async close() { closed = true; },
    }),
  });
  const result = await adapter.run("질문");
  assert.equal(result.protocolPass, false);
  assert.equal(result.telemetry.forbidden_tool_contamination, 1);
  assert.equal(result.telemetry.stop_reason, "AO_V2_LUNA_TOOL_CONTAMINATION");
  assert.equal(closed, true);
});
