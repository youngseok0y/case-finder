import crypto from "node:crypto";
import { caseNumberKey } from "../router.js";

export const BLIND30_ARM_IDS = Object.freeze(["gemini_d", "gemini_a6", "luna_native"]);
export const BLIND30_SEED = "m9-blind30-rotation-v1";
export const REVIEW_LABELS = Object.freeze(["DIRECT", "STRONG_SUPPORT", "WEAK_SUPPORT", "IRRELEVANT", "UNRESOLVED"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function validateBlindQuestions(questions) {
  if (!Array.isArray(questions) || questions.length !== 30) throw new Error("M9_BLIND30_QUESTION_COUNT_INVALID");
  const ids = new Set();
  const queries = new Set();
  for (const [index, question] of questions.entries()) {
    const expectedId = `B30-${String(index + 1).padStart(2, "0")}`;
    if (question?.id !== expectedId) throw new Error(`M9_BLIND30_QUESTION_ID_INVALID:${question?.id || ""}`);
    if (!text(question.query) || ids.has(question.id)) throw new Error(`M9_BLIND30_QUESTION_INVALID:${question.id}`);
    const queryKey = text(question.query).replace(/\s+/gu, " ").toLowerCase();
    if (queries.has(queryKey)) throw new Error(`M9_BLIND30_QUESTION_DUPLICATE:${question.id}`);
    if (Object.hasOwn(question, "expectedCaseNumbers")) throw new Error(`M9_BLIND30_GOLD_LEAK:${question.id}`);
    ids.add(question.id);
    queries.add(queryKey);
  }
  return questions;
}

export function rotateArms(questionIndex, arms = BLIND30_ARM_IDS) {
  if (!Array.isArray(arms) || arms.length !== 3) throw new Error("M9_BLIND30_ARM_COUNT_INVALID");
  const offset = questionIndex % arms.length;
  return arms.slice(offset).concat(arms.slice(0, offset));
}

export function planBlind30Slots(questions, { arms = BLIND30_ARM_IDS, seed = BLIND30_SEED } = {}) {
  validateBlindQuestions(questions);
  const slots = [];
  questions.forEach((question, questionIndex) => {
    rotateArms(questionIndex, arms).forEach((adapterId, armIndex) => {
      slots.push({
        slot_id: `${question.id}-${adapterId}`,
        question_id: question.id,
        query: question.query,
        question_index: questionIndex,
        arm_index: armIndex,
        adapter_id: adapterId,
        seed,
      });
    });
  });
  return slots;
}

export function normalizeProviderCaseIdentity(value) {
  const raw = text(value);
  return raw ? caseNumberKey(raw) : "";
}

function itemIdentity(item) {
  const identity = normalizeProviderCaseIdentity(item?.providerCaseNumber || item?.caseNumber || item?.case_no);
  if (identity) return identity;
  return `item:${sha256(JSON.stringify(item || {}))}`;
}

export function buildBlindPacket(runRecords) {
  const deduped = new Map();
  const questionIds = new Set();
  for (const run of Array.isArray(runRecords) ? runRecords : []) {
    if (text(run?.question_id)) questionIds.add(text(run.question_id));
    const items = Array.isArray(run?.result?.items) ? run.result.items : [];
    for (const item of items) {
      const caseIdentity = itemIdentity(item);
      const key = `${run.question_id}\u0000${caseIdentity}`;
      if (deduped.has(key)) continue;
      deduped.set(key, {
        question_id: run.question_id,
        query: text(run.query),
        case_identity: caseIdentity,
        provider_case_evidence: text(item.providerCaseNumber || item.caseNumber || item.case_no),
        source_locator: text(item.link || item.providerId || item.provider_id || caseIdentity),
      });
    }
  }
  const samples = [...deduped.values()].map((item, index) => ({
    sample_id: `S-${String(index + 1).padStart(3, "0")}`,
    ...item,
  }));
  return {
    version: "m9-blind30-review-packet-v1",
    question_count: questionIds.size,
    question_ids: [...questionIds],
    sample_count: samples.length,
    samples,
  };
}

export function sealUnmask(runRecords, packet) {
  const bySample = new Map(packet.samples.map((sample) => [sample.sample_id, []]));
  for (const run of Array.isArray(runRecords) ? runRecords : []) {
    const items = Array.isArray(run?.result?.items) ? run.result.items : [];
    for (const item of items) {
      const identity = itemIdentity(item);
      const sample = packet.samples.find((candidate) => candidate.question_id === run.question_id && candidate.case_identity === identity);
      if (!sample) continue;
      const arms = bySample.get(sample.sample_id);
      if (arms && !arms.includes(run.adapter_id)) arms.push(run.adapter_id);
    }
  }
  return {
    version: "m9-blind30-unmask-v1",
    sealed: true,
    entries: [...bySample.entries()].map(([sample_id, arms]) => ({ sample_id, arms: [...arms].sort() })),
  };
}

export function validateReviewLabels(labels, packet) {
  const known = new Set(packet.samples.map((sample) => sample.sample_id));
  const seen = new Set();
  for (const label of Array.isArray(labels) ? labels : []) {
    if (!known.has(label?.sample_id) || seen.has(label.sample_id)) throw new Error(`M9_REVIEW_SAMPLE_INVALID:${label?.sample_id || ""}`);
    if (!REVIEW_LABELS.includes(label.label)) throw new Error(`M9_REVIEW_LABEL_INVALID:${label?.sample_id || ""}`);
    if (label.issue_axes !== undefined && !Array.isArray(label.issue_axes)) throw new Error(`M9_REVIEW_ISSUE_AXES_INVALID:${label.sample_id}`);
    seen.add(label.sample_id);
  }
  if (seen.size !== known.size) throw new Error("M9_REVIEW_LABEL_COUNT_INVALID");
  return labels;
}

export function unmaskReview(labels, packet, sealedUnmask) {
  validateReviewLabels(labels, packet);
  if (!sealedUnmask?.sealed || !Array.isArray(sealedUnmask.entries)) throw new Error("M9_UNMASK_NOT_SEALED");
  const armsBySample = new Map(sealedUnmask.entries.map((entry) => [entry.sample_id, entry.arms]));
  return labels.map((label) => ({ ...label, arms: [...(armsBySample.get(label.sample_id) || [])] }));
}
