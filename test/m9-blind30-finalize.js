import fs from "node:fs";
import path from "node:path";
import { buildBlindPacket, sealUnmask, unmaskReview, validateReviewLabels } from "../src/blind30/protocol.js";
import { M9_BLIND30_PRIVATE_DIR } from "./m9-blind30-run.js";

const paths = {
  fullRun: path.join(M9_BLIND30_PRIVATE_DIR, "run.json"),
  oldPacket: path.join(M9_BLIND30_PRIVATE_DIR, "blind_packet.json"),
  oldLabels: path.join(M9_BLIND30_PRIVATE_DIR, "M9_BLIND30_LABELS.json"),
  lunaRun: path.join(M9_BLIND30_PRIVATE_DIR, "luna-rerun.json"),
  lunaPacket: path.join(M9_BLIND30_PRIVATE_DIR, "luna_blind_packet.json"),
  lunaLabels: path.join(M9_BLIND30_PRIVATE_DIR, "M9_LUNA_LABELS.json"),
  combinedRun: path.join(M9_BLIND30_PRIVATE_DIR, "combined-run.json"),
  combinedPacket: path.join(M9_BLIND30_PRIVATE_DIR, "blind_packet_combined.json"),
  combinedLabels: path.join(M9_BLIND30_PRIVATE_DIR, "M9_BLIND30_COMBINED_LABELS.json"),
  combinedSealedUnmask: path.join(M9_BLIND30_PRIVATE_DIR, "sealed_unmask_combined.json"),
  combinedUnmask: path.join(M9_BLIND30_PRIVATE_DIR, "unmask_combined.json"),
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function identity(sample) {
  return `${sample.question_id}\u0000${sample.case_identity}`;
}

function labelsByIdentity(packet, labels) {
  validateReviewLabels(labels, packet);
  return new Map(packet.samples.map((sample, index) => [identity(sample), labels[index]]));
}

export function finalizeM9Blind30() {
  const fullRun = readJson(paths.fullRun);
  const oldPacket = readJson(paths.oldPacket);
  const oldLabels = readJson(paths.oldLabels);
  const lunaRun = readJson(paths.lunaRun);
  const lunaPacket = readJson(paths.lunaPacket);
  const lunaLabels = readJson(paths.lunaLabels);
  const oldLabelsByIdentity = labelsByIdentity(oldPacket, oldLabels);
  const lunaLabelsByIdentity = labelsByIdentity(lunaPacket, lunaLabels);
  const geminiRecords = fullRun.records.filter((record) => ["gemini_d", "gemini_a6"].includes(record.adapter_id));
  const records = [...geminiRecords, ...lunaRun.records];
  if (records.length !== 90) throw new Error(`M9_BLIND30_COMBINED_RECORD_COUNT_INVALID:${records.length}`);
  const combinedRun = {
    version: "m9-blind30-combined-run-v1",
    source_runs: ["run.json", "luna-rerun.json"],
    questions: fullRun.questions,
    slots: records.map(({ result, ...slot }) => slot),
    records,
  };
  const packet = buildBlindPacket(records);
  const labels = packet.samples.map((sample) => {
    const oldLabel = oldLabelsByIdentity.get(identity(sample));
    const lunaLabel = lunaLabelsByIdentity.get(identity(sample));
    if (oldLabel && lunaLabel && oldLabel.label !== lunaLabel.label) {
      throw new Error(`M9_REVIEW_LABEL_CONFLICT:${sample.question_id}:${sample.case_identity}`);
    }
    const source = oldLabel || lunaLabel;
    if (!source) throw new Error(`M9_REVIEW_LABEL_MISSING:${sample.question_id}:${sample.case_identity}`);
    return { sample_id: sample.sample_id, label: source.label, issue_axes: [...(source.issue_axes || [])] };
  });
  validateReviewLabels(labels, packet);
  const sealedUnmask = sealUnmask(records, packet);
  const unmasked = unmaskReview(labels, packet, sealedUnmask);
  const unmaskArtifact = {
    version: "m9-blind30-combined-unmasked-v1",
    source_runs: combinedRun.source_runs,
    run_record_count: records.length,
    question_count: packet.question_count,
    sample_count: packet.sample_count,
    label_count: labels.length,
    entries: unmasked,
  };
  fs.mkdirSync(M9_BLIND30_PRIVATE_DIR, { recursive: true });
  fs.writeFileSync(paths.combinedRun, `${JSON.stringify(combinedRun, null, 2)}\n`, "utf8");
  fs.writeFileSync(paths.combinedPacket, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  fs.writeFileSync(paths.combinedLabels, `${JSON.stringify(labels, null, 2)}\n`, "utf8");
  fs.writeFileSync(paths.combinedSealedUnmask, `${JSON.stringify(sealedUnmask, null, 2)}\n`, "utf8");
  fs.writeFileSync(paths.combinedUnmask, `${JSON.stringify(unmaskArtifact, null, 2)}\n`, "utf8");
  return { paths, combinedRun, packet, labels, sealedUnmask, unmaskArtifact };
}

const IS_MAIN = process.argv[1] && decodeURIComponent(import.meta.url).endsWith(process.argv[1].replaceAll("\\", "/"));
if (IS_MAIN) {
  const result = finalizeM9Blind30();
  console.log(JSON.stringify({
    checkpoint: "M9_BLIND30_COMBINED_UNMASK_COMPLETE",
    run_records: result.combinedRun.records.length,
    question_count: result.packet.question_count,
    sample_count: result.packet.sample_count,
    labels: result.labels.length,
    sealed: result.sealedUnmask.sealed,
    output: {
      packet: result.paths.combinedPacket,
      labels: result.paths.combinedLabels,
      unmask: result.paths.combinedUnmask,
    },
  }, null, 2));
}
