import assert from "node:assert/strict";
import test from "node:test";
import { createEvidenceLedger } from "../src/aoV2/evidenceLedger.js";
import { createGeminiNativeAo } from "../src/aoV2/providers/geminiNativeAo.js";
import { createLegalToolGateway } from "../src/aoV2/legalToolGateway.js";
import { createSafetyController } from "../src/aoV2/safety.js";
import { createTelemetry } from "../src/aoV2/telemetry.js";

test("Gemini native adapter keeps native contents/function responses inside provider adapter", async () => {
  const ledger = createEvidenceLedger({ provider: "gemini" });
  const telemetry = createTelemetry({ provider: "gemini", model: "fixture" });
  const gateway = createLegalToolGateway({
    ledger,
    telemetry,
    safety: createSafetyController({ legalToolMax: 10 }),
    callTool: async () => ({}),
    normalizeResult: async (name) => name === "search_decisions"
      ? { isError: false, items: [{ id: "d1", caseNumber: "2020다1234" }], rawText: "search" }
      : { isError: false, caseNumber: "2020다1234", rawText: "detail", sections: {} },
  });
  const seenContents = [];
  const responses = [
    { response: { functionCalls: [{ name: "search_decisions", id: "s1", args: { domain: "precedent", query: "계약" } }], candidates: [{ content: { role: "model", parts: [] } }], usageMetadata: {} } },
    { response: { functionCalls: [{ name: "get_decision_text", id: "d1", args: { domain: "precedent", id: "d1" } }], candidates: [{ content: { role: "model", parts: [] } }], usageMetadata: {} } },
    { response: { functionCalls: [], text: JSON.stringify({ selected: [{ case_no: "2020다1234", match: "direct" }], intro: "설명" }), usageMetadata: {} } },
  ];
  const adapter = createGeminiNativeAo({
    gateway,
    ledger,
    telemetry,
    generateTurn: async (contents) => {
      seenContents.push(contents);
      return responses.shift();
    },
    parseFinal: (response) => JSON.parse(response.text),
  });
  const result = await adapter.run("계약 질문");
  assert.deepEqual(result.selected, [{ case_no: "2020다1234", match: "direct" }]);
  assert.equal(result.telemetry.output_valid, true);
  assert.equal(result.telemetry.model_protocol_clean, true);
  assert.equal(result.telemetry.selection_repaired, false);
  assert.equal(result.telemetry.protocol_pass, true);
  assert.equal(seenContents.length, 3);
  assert.equal(seenContents[1][1].role, "model");
  assert.equal(seenContents[2][2].parts[0].functionResponse.name, "search_decisions");
  assert.equal(seenContents[2][2].parts[0].functionResponse.response.output.isError, false);
  assert.equal(seenContents[2][4].parts[0].functionResponse.name, "get_decision_text");
});
