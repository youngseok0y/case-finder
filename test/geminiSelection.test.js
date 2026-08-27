import assert from "node:assert/strict";
import test from "node:test";

import { validateSelection } from "../src/gemini.js";

test("direct support keeps direct selection", () => {
  assert.deepEqual(validateSelection({
    support: "direct",
    selected: [{ case_no: "2024다12345", match: "direct" }],
    intro: "직접 관련 판례예요.",
  }), {
    support: "direct",
    selected: [{ case_no: "2024다12345", match: "direct" }],
    intro: "직접 관련 판례예요.",
  });
});

test("related_only safely normalizes direct matches to related", () => {
  assert.deepEqual(validateSelection({
    support: "related_only",
    selected: [{ case_no: "2024다12345", match: "direct" }],
    intro: "관련 판례예요.",
  }), {
    support: "related_only",
    selected: [{ case_no: "2024다12345", match: "related" }],
    intro: "관련 판례예요.",
  });
});

test("none discards selected cases", () => {
  assert.deepEqual(validateSelection({
    support: "none",
    selected: [{ case_no: "2024다12345", match: "direct" }],
    intro: "",
  }), { support: "none", selected: [], intro: "" });
});

test("direct without a direct item downgrades to related_only", () => {
  assert.deepEqual(validateSelection({
    support: "direct",
    selected: [{ case_no: "2024다12345", match: "related" }],
    intro: "관련 판례예요.",
  }), {
    support: "related_only",
    selected: [{ case_no: "2024다12345", match: "related" }],
    intro: "관련 판례예요.",
  });
});

test("direct with no selection downgrades to none", () => {
  assert.deepEqual(validateSelection({ support: "direct", selected: [], intro: "" }), {
    support: "none",
    selected: [],
    intro: "",
  });
});

test("selection remains capped at resultMax", () => {
  const selected = Array.from({ length: 7 }, (_, index) => ({
    case_no: `2024다${String(index).padStart(5, "0")}`,
    match: "related",
  }));
  assert.equal(validateSelection({ support: "related_only", selected, intro: "" }).selected.length, 5);
});
