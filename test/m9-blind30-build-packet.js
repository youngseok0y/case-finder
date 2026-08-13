import { buildBlindPacket, sealUnmask } from "../src/blind30/protocol.js";
import { createDummyRegistry, loadDummyQuestions, runBlind30 } from "./m9-blind30-run.js";

export function buildPacketFromRuns(runRecords) {
  const packet = buildBlindPacket(runRecords);
  const sealedUnmask = sealUnmask(runRecords, packet);
  return { packet, sealedUnmask };
}

const IS_MAIN = process.argv[1] && decodeURIComponent(import.meta.url).endsWith(process.argv[1].replaceAll("\\", "/"));

if (IS_MAIN && process.argv.includes("--dry-run")) {
  const run = await runBlind30({ questions: loadDummyQuestions(), registry: createDummyRegistry() });
  const { packet, sealedUnmask } = buildPacketFromRuns(run.records);
  console.log(JSON.stringify({
    question_count: packet.question_count,
    sample_count: packet.sample_count,
    sealed: sealedUnmask.sealed,
    unmask_entries: sealedUnmask.entries.length,
  }, null, 2));
} else if (IS_MAIN) {
  throw new Error("M9_PACKET_BUILD_REQUIRES_DRY_RUN");
}
