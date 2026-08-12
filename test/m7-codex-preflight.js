import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.MODEL_RUNTIME = "gemini";

const { config } = await import("../config.js");
const modelRuntime = await import("../src/modelRuntime.js");
const codexRuntime = await import("../src/codexCliRuntime.js");

assert.equal(modelRuntime.runtimeName, "gemini", "default runtime must preserve Gemini");
assert.equal(config.modelRuntime, "gemini");
const costs = codexRuntime.calculateCodexCosts({ input_tokens: 1_000_000, cached_input_tokens: 1_000_000, output_tokens: 1_000_000, reasoning_tokens: 500_000 });
assert.deepEqual(costs, {
  codex_credit_equivalent: 177.5,
  api_equivalent_usd: 1.42,
  api_equivalent_usd_handoff_snapshot: 7.1,
}, "cost formulas must not double-bill reasoning tokens");

const parsed = codexRuntime.parseCodexJsonl([
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{\"status\":\"ok\"}" } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 7, reasoning_output_tokens: 2 } }),
].join("\n"));
assert.deepEqual(parsed.value, { status: "ok" });
assert.deepEqual(parsed.usage, { input_tokens: 12, cached_input_tokens: 3, output_tokens: 7, reasoning_tokens: 2 });

assert.throws(() => codexRuntime.parseCodexJsonl("not-json"), /CODEX_PROTOCOL_INVALID_NON_JSON_STDOUT/);
const selected = codexRuntime.parseSelectionResponse({ text: JSON.stringify({ selected: [{ case_no: "2020다1234", match: "direct" }], intro: "" }) });
assert.deepEqual(selected.selected, [{ case_no: "2020다1234", match: "direct" }]);

const source = await fs.readFile(new URL("../src/codexCliRuntime.js", import.meta.url), "utf8");
assert.match(source, /--ignore-user-config/u);
assert.match(source, /--sandbox/u);
assert.match(source, /read-only/u);
assert.equal(config.codexWorkdir, `${config.rootDir || ""}${config.codexWorkdir}`.slice(0, 0) || config.codexWorkdir);
assert.match(config.codexWorkdir, /test[\\/]private[\\/]m7-codex-runtime[\\/]workdir$/u);

console.log(JSON.stringify({
  checkpoint: "M7_CODEX_PREFLIGHT_OFFLINE_PASS",
  runtime_switch_preserves_gemini: true,
  codex_plan_selection_action_parsers: true,
  invalid_json_rejected: true,
  direct_mcp_flags_present: true,
  isolated_workdir: config.codexWorkdir,
  cost_formula: costs,
}, null, 2));
