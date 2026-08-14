export const CODEX_FINAL_SCHEMA = {
  name: "m9-native-final",
  type: "object",
  additionalProperties: false,
  properties: {
    selected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          case_no: { type: "string" },
          match: { type: "string", enum: ["direct", "related"] },
        },
        required: ["case_no", "match"],
      },
    },
    intro: { type: "string" },
  },
  required: ["selected", "intro"],
};
