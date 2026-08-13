import { buildBlindPacket, sealUnmask } from "../src/blind30/protocol.js";
import fs from "node:fs";
import path from "node:path";
import { M9_BLIND30_PRIVATE_DIR, createDummyRegistry, loadDummyQuestions, loadLiveRun, runBlind30 } from "./m9-blind30-run.js";

export const M9_BLIND30_PACKET_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "blind_packet.json");
export const M9_BLIND30_UNMASK_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "sealed_unmask.json");

function writeLiveArtifacts(packet, sealedUnmask) {
  fs.mkdirSync(M9_BLIND30_PRIVATE_DIR, { recursive: true });
  fs.writeFileSync(M9_BLIND30_PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  fs.writeFileSync(M9_BLIND30_UNMASK_PATH, `${JSON.stringify(sealedUnmask, null, 2)}\n`, "utf8");
}

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
} else if (IS_MAIN && process.argv.includes("--execute")) {
  const run = loadLiveRun();
  const { packet, sealedUnmask } = buildPacketFromRuns(run.records);
  writeLiveArtifacts(packet, sealedUnmask);
  console.log(JSON.stringify({
    checkpoint: "M9_BLIND30_PACKET_READY",
    question_count: packet.question_count,
    sample_count: packet.sample_count,
    sealed: sealedUnmask.sealed,
    packet: M9_BLIND30_PACKET_PATH,
    unmask: M9_BLIND30_UNMASK_PATH,
  }, null, 2));
} else if (IS_MAIN) {
  throw new Error("M9_PACKET_BUILD_REQUIRES_EXECUTE_OR_DRY_RUN");
}
