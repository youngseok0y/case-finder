import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "../config.js";
import { assertResultContract, createSearchAdapterRegistry, toResultContract } from "../src/searchAdapters/index.js";
import { BLIND30_ARM_IDS, planBlind30Slots, validateBlindQuestions } from "../src/blind30/protocol.js";

const DUMMY_FIXTURE_PATH = new URL("./fixtures/m9-blind30-dummy.json", import.meta.url);
export const M9_BLIND30_PRIVATE_DIR = path.resolve(ROOT_DIR, "test", "private", "m9-blind30");
export const M9_BLIND30_QUESTIONS_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "questions.json");
export const M9_BLIND30_RUN_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "run.json");

export function loadDummyQuestions() {
  const fixture = JSON.parse(fs.readFileSync(DUMMY_FIXTURE_PATH, "utf8"));
  return fixture.questions;
}

export function loadPrivateQuestions() {
  if (!fs.existsSync(M9_BLIND30_QUESTIONS_PATH)) {
    throw new Error(`M9_BLIND30_INPUT_MISSING:${M9_BLIND30_QUESTIONS_PATH}`);
  }
  const document = JSON.parse(fs.readFileSync(M9_BLIND30_QUESTIONS_PATH, "utf8"));
  if (document?.version !== "m9-blind30-v1") throw new Error("M9_BLIND30_INPUT_VERSION_INVALID");
  return validateBlindQuestions(document.questions);
}

export function writeLiveRun(run) {
  fs.mkdirSync(M9_BLIND30_PRIVATE_DIR, { recursive: true });
  fs.writeFileSync(M9_BLIND30_RUN_PATH, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return M9_BLIND30_RUN_PATH;
}

export function loadLiveRun() {
  if (!fs.existsSync(M9_BLIND30_RUN_PATH)) throw new Error(`M9_BLIND30_RUN_MISSING:${M9_BLIND30_RUN_PATH}`);
  const run = JSON.parse(fs.readFileSync(M9_BLIND30_RUN_PATH, "utf8"));
  if (run?.records?.length !== 90) throw new Error("M9_BLIND30_INCOMPLETE");
  return run;
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

export async function runBlind30({ questions, registry = createSearchAdapterRegistry(), execute } = {}) {
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

export async function runLiveBlind30({ registry = createSearchAdapterRegistry() } = {}) {
  const run = await runBlind30({ questions: loadPrivateQuestions(), registry });
  if (run.records.length !== 90) throw new Error("M9_BLIND30_INCOMPLETE");
  return run;
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
} else if (IS_MAIN && process.argv.includes("--execute")) {
  const run = await runLiveBlind30();
  const output = writeLiveRun(run);
  console.log(JSON.stringify({
    checkpoint: "M9_BLIND30_RUN_COMPLETE",
    ...summarizeBlind30Run(run),
    output,
  }, null, 2));
} else if (IS_MAIN) {
  throw new Error("M9_LIVE_REQUIRES_EXECUTE");
}
