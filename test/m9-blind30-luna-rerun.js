import fs from "node:fs";
import path from "node:path";
import { assertResultContract, createSearchAdapterRegistry } from "../src/searchAdapters/index.js";
import { planBlind30Slots, validateBlindQuestions } from "../src/blind30/protocol.js";
import { M9_BLIND30_PRIVATE_DIR, createDummyRegistry, loadDummyQuestions, loadPrivateQuestions } from "./m9-blind30-run.js";

export const M9_BLIND30_LUNA_RERUN_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "luna-rerun.json");

function lunaSlots(questions) {
  return planBlind30Slots(validateBlindQuestions(questions))
    .filter((slot) => slot.adapter_id === "luna_native");
}

export async function runLunaRerun({ questions, registry = createSearchAdapterRegistry(), execute } = {}) {
  const validatedQuestions = validateBlindQuestions(questions);
  const slots = lunaSlots(validatedQuestions);
  const run = execute || ((adapter, slot) => adapter.runNaturalQuery(slot.query, { blind_slot: slot }));
  const records = [];
  for (const slot of slots) {
    const adapter = registry.resolve("luna_native");
    const result = assertResultContract(await run(adapter, slot));
    records.push({ ...slot, result });
  }
  return {
    version: "m9-blind30-luna-rerun-v1",
    questions: validatedQuestions,
    slots,
    records,
  };
}

export function writeLunaRerun(run) {
  if (run.records.length !== 30) throw new Error("M9_BLIND30_LUNA_RERUN_INCOMPLETE");
  fs.mkdirSync(M9_BLIND30_PRIVATE_DIR, { recursive: true });
  fs.writeFileSync(M9_BLIND30_LUNA_RERUN_PATH, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return M9_BLIND30_LUNA_RERUN_PATH;
}

function summarize(run) {
  return {
    question_count: run.questions.length,
    slot_count: run.slots.length,
    record_count: run.records.length,
    adapter_ids: [...new Set(run.records.map((record) => record.adapter_id))],
    result_items: run.records.reduce((sum, record) => sum + record.result.items.length, 0),
  };
}

const IS_MAIN = process.argv[1] && decodeURIComponent(import.meta.url).endsWith(process.argv[1].replaceAll("\\", "/"));

if (IS_MAIN && process.argv.includes("--dry-run")) {
  const run = await runLunaRerun({ questions: loadDummyQuestions(), registry: createDummyRegistry() });
  console.log(JSON.stringify(summarize(run), null, 2));
} else if (IS_MAIN && process.argv.includes("--execute")) {
  const run = await runLunaRerun({ questions: loadPrivateQuestions() });
  const output = writeLunaRerun(run);
  console.log(JSON.stringify({ checkpoint: "M9_BLIND30_LUNA_RERUN_COMPLETE", ...summarize(run), output }, null, 2));
} else if (IS_MAIN) {
  throw new Error("M9_BLIND30_LUNA_RERUN_REQUIRES_EXECUTE_OR_DRY_RUN");
}
