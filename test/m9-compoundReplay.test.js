import assert from "node:assert/strict";
import test from "node:test";
import { runSyntheticCompoundReplay } from "./m9-compound-replay.js";

test("M9 compound replay accepts verified provider members and rejects invented siblings", () => {
  assert.deepEqual(runSyntheticCompoundReplay(), {
    recovered: "2014두12598",
    inventedSibling: "CASE_NOT_OBSERVED",
  });
});
