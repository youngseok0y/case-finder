import assert from "node:assert/strict";
import test from "node:test";
import { buildBlindPacket, sealUnmask, unmaskReview } from "../src/blind30/protocol.js";
import { createDummyRegistry, loadDummyQuestions, runBlind30 } from "./m9-blind30-run.js";

test("M9 dry-run plans 30 questions, 90 rotated slots, and three result contracts per question", async () => {
  const questions = loadDummyQuestions();
  const run = await runBlind30({ questions, registry: createDummyRegistry() });
  assert.equal(run.questions.length, 30);
  assert.equal(run.slots.length, 90);
  assert.equal(run.records.length, 90);
  assert.deepEqual(run.slots.slice(0, 3).map((slot) => slot.adapter_id), ["gemini_d", "gemini_a6", "luna_native"]);
  assert.deepEqual(run.slots.slice(3, 6).map((slot) => slot.adapter_id), ["gemini_a6", "luna_native", "gemini_d"]);
  assert.deepEqual(run.slots.slice(6, 9).map((slot) => slot.adapter_id), ["luna_native", "gemini_d", "gemini_a6"]);
  assert.ok(run.records.every((record) => record.result.contract_version === "m9-result-contract-v1"));
});

test("M9 packet deduplicates provider case identity and keeps arm identity sealed", async () => {
  const run = await runBlind30({ questions: loadDummyQuestions(), registry: createDummyRegistry() });
  const packet = buildBlindPacket(run.records);
  assert.equal(packet.question_count, 30);
  assert.equal(packet.sample_count, 30);
  assert.ok(packet.samples.every((sample) => !Object.hasOwn(sample, "adapter_id")));
  const sealedUnmask = sealUnmask(run.records, packet);
  assert.equal(sealedUnmask.sealed, true);
  assert.ok(sealedUnmask.entries.every((entry) => entry.arms.length === 3));
  const labels = packet.samples.map((sample) => ({ sample_id: sample.sample_id, label: "UNRESOLVED", issue_axes: [] }));
  const unmasked = unmaskReview(labels, packet, sealedUnmask);
  assert.equal(unmasked.length, 30);
  assert.deepEqual(unmasked[0].arms, ["gemini_a6", "gemini_d", "luna_native"]);
});

test("M9 question validation refuses expected-case leakage", async () => {
  const questions = loadDummyQuestions();
  questions[0].expectedCaseNumbers = ["not included"];
  await assert.rejects(
    () => runBlind30({ questions, registry: createDummyRegistry() }),
    /M9_BLIND30_GOLD_LEAK/,
  );
});
