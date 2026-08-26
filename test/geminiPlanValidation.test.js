import assert from "node:assert/strict";
import test from "node:test";

import { validatePlan } from "../src/gemini.js";

test("plan validation accepts a valid atomic-anchor plan", () => {
  const plan = validatePlan({
    queries: [
      { query: "간통죄", domain: "constitutional", kind: "anchor" },
      { query: "형법 제241조", domain: "constitutional", kind: "anchor" },
      { query: "간통죄 위헌", domain: "constitutional", kind: "support" },
      { query: "간통죄", domain: "precedent", kind: "support" },
    ],
    law_names: ["형법"],
  });
  assert.deepEqual(plan.queries, [
    { query: "간통죄", domain: "constitutional", kind: "anchor" },
    { query: "형법 제241조", domain: "constitutional", kind: "anchor" },
    { query: "간통죄 위헌", domain: "constitutional", kind: "support" },
    { query: "간통죄", domain: "precedent", kind: "support" },
  ]);
  assert.deepEqual(plan.law_names, ["형법"]);
});

test("plan validation rejects a four-query plan with fewer than two anchors", () => {
  assert.throws(() => validatePlan({
    queries: [
      { query: "간통죄 위헌결정", domain: "constitutional", kind: "anchor" },
      { query: "성적 자기결정권", domain: "constitutional", kind: "support" },
      { query: "혼인과 가족", domain: "precedent", kind: "support" },
      { query: "위헌심판", domain: "constitutional", kind: "support" },
    ],
    law_names: [],
  }), /2개 이상의 anchor/u);
});
