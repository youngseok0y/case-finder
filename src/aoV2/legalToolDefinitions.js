import { config } from "../../config.js";

export const LEGAL_TOOL_NAMES = Object.freeze([
  "search_decisions",
  "search_law",
  "get_decision_text",
  "get_law_text",
]);

export function createLegalDynamicTools({
  searchDisplay = config.searchDisplay,
  lawSearchDisplay = config.lawSearchDisplay,
} = {}) {
  return Object.freeze([
    {
      type: "function",
      name: "search_decisions",
      description: "판례 또는 헌재 결정례를 검색합니다. 검색 결과의 사건번호와 id만 근거로 후속 조회하세요.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string", enum: ["precedent", "constitutional", "admin_appeal"] },
          query: { type: "string" },
          display: { type: "integer", minimum: 1, maximum: searchDisplay },
        },
        required: ["domain", "query"],
      },
    },
    {
      type: "function",
      name: "search_law",
      description: "법령명을 검색해 법령일련번호(mst) 또는 법령ID(lawId)를 확인합니다.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          display: { type: "integer", minimum: 1, maximum: lawSearchDisplay },
        },
        required: ["query"],
      },
    },
    {
      type: "function",
      name: "get_decision_text",
      description: "검색 결과에서 확인한 id의 판례·결정례 원문을 축약 모드로 조회합니다.",
      inputSchema: {
        type: "object",
        properties: {
          domain: { type: "string", enum: ["precedent", "constitutional", "admin_appeal"] },
          id: { type: "string" },
        },
        required: ["domain", "id"],
      },
    },
    {
      type: "function",
      name: "get_law_text",
      description: "검색 결과에서 확인한 mst 또는 lawId의 조문 원문을 조회합니다.",
      inputSchema: {
        type: "object",
        properties: {
          mst: { type: "string" },
          lawId: { type: "string" },
          jo: { type: "string" },
        },
      },
    },
  ]);
}

export const LEGAL_DYNAMIC_TOOLS = createLegalDynamicTools();
