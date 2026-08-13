import { unmaskReview } from "../src/blind30/protocol.js";
import { buildPacketFromRuns } from "./m9-blind30-build-packet.js";
import { createDummyRegistry, loadDummyQuestions, runBlind30 } from "./m9-blind30-run.js";

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
} else if (IS_MAIN) {
  throw new Error("M9_UNMASK_REQUIRES_DRY_RUN");
}
