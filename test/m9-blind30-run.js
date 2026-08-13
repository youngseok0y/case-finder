import fs from "node:fs";
import { assertResultContract, createSearchAdapterRegistry, toResultContract } from "../src/searchAdapters/index.js";
import { BLIND30_ARM_IDS, planBlind30Slots, validateBlindQuestions } from "../src/blind30/protocol.js";

const DUMMY_FIXTURE_PATH = new URL("./fixtures/m9-blind30-dummy.json", import.meta.url);

export function loadDummyQuestions() {
  const fixture = JSON.parse(fs.readFileSync(DUMMY_FIXTURE_PATH, "utf8"));
  return fixture.questions;
}

function dummyCaseNumber(questionIndex) {
  return `2024다${1000 + questionIndex}`;
}

export function createDummyRegistry() {
  const adapters = Object.fromEntries(BLIND30_ARM_IDS.map((adapterId) => [adapterId, {
    id: adapterId,
    async runNaturalQuery(query, { blind_slot: slot } = {}) {
      const caseNumber = dummyCaseNumber(slot.question_index);
      return toResultContract({
        route: "natural",
        query,
        selected: [{ case_no: caseNumber, match: "direct" }],
        items: [{
          caseNumber,
          providerCaseNumber: caseNumber,
          providerId: `dummy-${adapterId}-${slot.question_id}`,
          link: `/dummy/${caseNumber}`,
        }],
        output_valid: true,
        model_protocol_clean: true,
        selection_repaired: false,
      }, {
        adapterId,
        provider: adapterId === "luna_native" ? "luna" : "gemini",
        architecture: adapterId === "luna_native" ? "AO_V2_NATIVE" : adapterId === "gemini_a6" ? "A6" : "D",
      });
    },
  }]));
  return createSearchAdapterRegistry({ adapters });
}

export async function runBlind30({ questions, registry, execute } = {}) {
  const validatedQuestions = validateBlindQuestions(questions);
  const slots = planBlind30Slots(validatedQuestions);
  const run = execute || ((adapter, slot) => adapter.runNaturalQuery(slot.query, { blind_slot: slot }));
  const records = [];
  for (const slot of slots) {
    const adapter = registry.resolve(slot.adapter_id);
    const result = assertResultContract(await run(adapter, slot));
    records.push({ ...slot, result });
  }
  return { questions: validatedQuestions, slots, records };
}

export function summarizeBlind30Run(run) {
  return {
    question_count: run.questions.length,
    slot_count: run.slots.length,
    adapter_counts: Object.fromEntries(BLIND30_ARM_IDS.map((id) => [id, run.slots.filter((slot) => slot.adapter_id === id).length])),
    result_contract_count: run.records.filter((record) => record.result.contract_version).length,
  };
}

const IS_MAIN = process.argv[1] && decodeURIComponent(import.meta.url).endsWith(process.argv[1].replaceAll("\\", "/"));

if (IS_MAIN && process.argv.includes("--dry-run")) {
  const run = await runBlind30({ questions: loadDummyQuestions(), registry: createDummyRegistry() });
  console.log(JSON.stringify(summarizeBlind30Run(run), null, 2));
} else if (IS_MAIN) {
  throw new Error("M9_LIVE_DISABLED_IN_PREP");
}
