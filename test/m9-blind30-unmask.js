import { unmaskReview } from "../src/blind30/protocol.js";
import fs from "node:fs";
import path from "node:path";
import { M9_BLIND30_PRIVATE_DIR, M9_BLIND30_RUN_PATH, loadLiveRun } from "./m9-blind30-run.js";
import { M9_BLIND30_PACKET_PATH, M9_BLIND30_UNMASK_PATH } from "./m9-blind30-build-packet.js";
import { createDummyRegistry, loadDummyQuestions, runBlind30 } from "./m9-blind30-run.js";

export const M9_BLIND30_LABELS_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "M9_BLIND30_LABELS.json");
export const M9_BLIND30_UNMASKED_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "unmask.json");

export function unmask(labels, packet, sealedUnmask) {
  return unmaskReview(labels, packet, sealedUnmask);
}

const IS_MAIN = process.argv[1] && decodeURIComponent(import.meta.url).endsWith(process.argv[1].replaceAll("\\", "/"));

if (IS_MAIN && process.argv.includes("--dry-run")) {
  const run = await runBlind30({ questions: loadDummyQuestions(), registry: createDummyRegistry() });
  const { packet, sealedUnmask } = buildPacketFromRuns(run.records);
  const labels = packet.samples.map((sample) => ({ sample_id: sample.sample_id, label: "UNRESOLVED" }));
  const unmasked = unmask(labels, packet, sealedUnmask);
  console.log(JSON.stringify({ label_count: unmasked.length, first_sample_arms: unmasked[0]?.arms || [] }, null, 2));
} else if (IS_MAIN && process.argv.includes("--execute")) {
  const run = loadLiveRun();
  const packet = JSON.parse(fs.readFileSync(M9_BLIND30_PACKET_PATH, "utf8"));
  const sealedUnmask = JSON.parse(fs.readFileSync(M9_BLIND30_UNMASK_PATH, "utf8"));
  const labels = JSON.parse(fs.readFileSync(M9_BLIND30_LABELS_PATH, "utf8"));
  const unmasked = unmask(labels, packet, sealedUnmask);
  const output = {
    version: "m9-blind30-unmasked-v1",
    run_record_count: run.records.length,
    question_count: run.questions.length,
    sample_count: packet.sample_count,
    label_count: labels.length,
    entries: unmasked,
  };
  fs.mkdirSync(M9_BLIND30_PRIVATE_DIR, { recursive: true });
  fs.writeFileSync(M9_BLIND30_UNMASKED_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    checkpoint: "M9_BLIND30_UNMASK_COMPLETE",
    run: M9_BLIND30_RUN_PATH,
    labels: M9_BLIND30_LABELS_PATH,
    output: M9_BLIND30_UNMASKED_PATH,
    label_count: labels.length,
  }, null, 2));
} else if (IS_MAIN) {
  throw new Error("M9_UNMASK_REQUIRES_EXECUTE_OR_DRY_RUN");
}
