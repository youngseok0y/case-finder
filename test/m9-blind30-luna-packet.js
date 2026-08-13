import fs from "node:fs";
import path from "node:path";
import { buildBlindPacket, sealUnmask } from "../src/blind30/protocol.js";
import { M9_BLIND30_PRIVATE_DIR } from "./m9-blind30-run.js";
import { M9_BLIND30_LUNA_RERUN_PATH } from "./m9-blind30-luna-rerun.js";

export const M9_BLIND30_LUNA_PACKET_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "luna_blind_packet.json");
export const M9_BLIND30_LUNA_UNMASK_PATH = path.join(M9_BLIND30_PRIVATE_DIR, "luna_sealed_unmask.json");

export function buildLunaPacket(run) {
  if (!run || run.records?.length !== 30) throw new Error("M9_BLIND30_LUNA_RERUN_INCOMPLETE");
  const packet = buildBlindPacket(run.records);
  const sealedUnmask = sealUnmask(run.records, packet);
  return { packet, sealedUnmask };
}

function writeArtifacts(packet, sealedUnmask) {
  fs.mkdirSync(M9_BLIND30_PRIVATE_DIR, { recursive: true });
  fs.writeFileSync(M9_BLIND30_LUNA_PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  fs.writeFileSync(M9_BLIND30_LUNA_UNMASK_PATH, `${JSON.stringify(sealedUnmask, null, 2)}\n`, "utf8");
}

const IS_MAIN = process.argv[1] && decodeURIComponent(import.meta.url).endsWith(process.argv[1].replaceAll("\\", "/"));

if (IS_MAIN && process.argv.includes("--execute")) {
  const run = JSON.parse(fs.readFileSync(M9_BLIND30_LUNA_RERUN_PATH, "utf8"));
  const { packet, sealedUnmask } = buildLunaPacket(run);
  writeArtifacts(packet, sealedUnmask);
  console.log(JSON.stringify({
    checkpoint: "M9_BLIND30_LUNA_PACKET_READY",
    question_count: packet.question_count,
    sample_count: packet.sample_count,
    sealed: sealedUnmask.sealed,
    packet: M9_BLIND30_LUNA_PACKET_PATH,
    unmask: M9_BLIND30_LUNA_UNMASK_PATH,
  }, null, 2));
} else if (IS_MAIN && process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ checkpoint: "M9_BLIND30_LUNA_PACKET_DRY_RUN_ONLY" }, null, 2));
} else if (IS_MAIN) {
  throw new Error("M9_BLIND30_LUNA_PACKET_REQUIRES_EXECUTE_OR_DRY_RUN");
}
