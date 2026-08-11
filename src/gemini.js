import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { config, ROOT_DIR } from "../config.js";
import { reserveGeminiCall } from "./rateLimiter.js";

let client = null;
let planPrompt = null;
let selectPrompt = null;
let agentPrompt = null;

const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    keywords: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: 8, maxItems: 12 },
    law_names: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
    domains: { type: Type.ARRAY, items: { type: Type.STRING, enum: ["precedent", "constitutional", "admin_appeal"] }, minItems: 1, maxItems: 3 },
  },
  required: ["keywords", "law_names", "domains"],
};

function selectionSchema(caseNumbers) {
  const caseNumberSchema = { type: Type.STRING };
  if (caseNumbers.length > 0) caseNumberSchema.enum = caseNumbers;
  return {
    type: Type.OBJECT,
    properties: {
      selected: {
        type: Type.ARRAY,
        maxItems: config.resultMax,
        items: {
          type: Type.OBJECT,
          properties: {
            case_no: caseNumberSchema,
            match: { type: Type.STRING, enum: ["direct", "related"] },
          },
          required: ["case_no", "match"],
        },
      },
      intro: { type: Type.STRING },
    },
    required: ["selected", "intro"],
  };
}

const AGENTIC_FUNCTIONS = [
  {
    name: "search_decisions",
    description: "판례 또는 헌재 결정례를 검색합니다. 검색 결과의 사건번호와 id만 근거로 후속 조회하세요.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        domain: { type: Type.STRING, enum: ["precedent", "constitutional", "admin_appeal"] },
        query: { type: Type.STRING },
        display: { type: Type.INTEGER, minimum: 1, maximum: config.searchDisplay },
      },
      required: ["domain", "query"],
    },
  },
  {
    name: "search_law",
    description: "법령명을 검색해 법령일련번호(mst) 또는 법령ID(lawId)를 확인합니다.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING },
        display: { type: Type.INTEGER, minimum: 1, maximum: 5 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_law_text",
    description: "검색 결과에서 확인한 mst 또는 lawId의 조문 원문을 조회합니다.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        mst: { type: Type.STRING },
        lawId: { type: Type.STRING },
        jo: { type: Type.STRING },
      },
    },
  },
  {
    name: "get_decision_text",
    description: "검색 결과에서 확인한 id의 판례·결정례 원문을 축약 모드로 조회합니다.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        domain: { type: Type.STRING, enum: ["precedent", "constitutional", "admin_appeal"] },
        id: { type: Type.STRING },
      },
      required: ["domain", "id"],
    },
  },
];

async function getClient() {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

async function getPrompt(name) {
  if (name === "plan") {
    planPrompt ||= await fs.readFile(path.join(ROOT_DIR, "prompts", "plan.txt"), "utf8");
    return planPrompt;
  }
  if (name === "agent") {
    agentPrompt ||= await fs.readFile(path.join(ROOT_DIR, "prompts", "agent.txt"), "utf8");
    return agentPrompt;
  }
  selectPrompt ||= await fs.readFile(path.join(ROOT_DIR, "prompts", "select.txt"), "utf8");
  return selectPrompt;
}

function fillPrompt(prompt, values) {
  return prompt
    .replace("{{USER_QUERY}}", values.query)
    .replace("{{CANDIDATES}}", values.candidates || "");
}

function parseJsonResponse(response) {
  const text = response?.text?.trim();
  if (!text) throw new Error("Gemini가 빈 응답을 반환했습니다.");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini JSON 응답 파싱 실패: ${error.message}`);
  }
}

function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.keywords) || plan.keywords.length < 1 || plan.keywords.length > 12) {
    throw new Error("Gemini 검색계획의 keywords 형식이 올바르지 않습니다.");
  }
  const keywords = [...new Set(plan.keywords.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  const lawNames = [...new Set((Array.isArray(plan.law_names) ? plan.law_names : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))].slice(0, 5);
  const domains = [...new Set((Array.isArray(plan.domains) ? plan.domains : []).filter((value) => ["precedent", "constitutional", "admin_appeal"].includes(value)))];
  if (keywords.length === 0 || domains.length === 0) throw new Error("Gemini 검색계획 필수값이 비어 있습니다.");
  return { keywords: keywords.slice(0, 12), law_names: lawNames, domains: domains.slice(0, 3) };
}

function validateSelection(selection) {
  if (!selection || !Array.isArray(selection.selected)) throw new Error("Gemini 선별 응답의 selected 형식이 올바르지 않습니다.");
  return {
    selected: selection.selected.slice(0, config.resultMax).filter((item) => item && typeof item.case_no === "string" && (item.match === "direct" || item.match === "related")),
    intro: typeof selection.intro === "string" ? selection.intro.trim() : "",
  };
}

export function parseSelectionResponse(response) {
  return validateSelection(parseJsonResponse(response));
}

function isRateLimitError(error) {
  const status = error?.status ?? error?.statusCode;
  const message = String(error?.message || error || "");
  return status === 429 || /\b429\b|resource exhausted|rate limit|quota/i.test(message);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generateContent(request, options = {}) {
  const ai = await getClient();
  await reserveGeminiCall(Date.now(), options);
  try {
    const response = await ai.models.generateContent(request);
    return options.returnMeta ? { response, callsUsed: 1 } : response;
  } catch (error) {
    if (!isRateLimitError(error)) throw error;
    await wait(config.geminiRetryDelayMs);
    const retryOptions = Number.isInteger(options.questionCalls)
      ? { ...options, questionCalls: options.questionCalls + 1 }
      : options;
    await reserveGeminiCall(Date.now(), retryOptions);
    const response = await ai.models.generateContent(request);
    return options.returnMeta ? { response, callsUsed: 2 } : response;
  }
}

export async function generateAgenticTurn(contents, observedCaseNumbers, questionCalls) {
  return generateContent({
    model: config.geminiModel,
    contents,
    config: {
      systemInstruction: await getPrompt("agent"),
      tools: [{ functionDeclarations: AGENTIC_FUNCTIONS }],
      responseMimeType: "application/json",
      responseSchema: selectionSchema(observedCaseNumbers),
    },
  }, { questionCalls, returnMeta: true });
}

export async function generatePlan(query) {
  const response = await generateContent({
    model: config.geminiModel,
    contents: fillPrompt(await getPrompt("plan"), { query }),
    config: { responseMimeType: "application/json", responseSchema: PLAN_SCHEMA },
  });
  return validatePlan(parseJsonResponse(response));
}

export async function selectCandidates(query, candidates) {
  if (candidates.length === 0) return { selected: [], intro: "" };
  const candidateText = candidates.map((candidate) => JSON.stringify({
    case_no: candidate.caseNumber,
    title: candidate.title,
    date: candidate.date,
    court: candidate.court,
    판시사항앞300자: String(candidate.preview || "").slice(0, 300),
  })).join("\n");
  const response = await generateContent({
    model: config.geminiModel,
    contents: fillPrompt(await getPrompt("select"), {
      query,
      candidates: candidateText,
    }),
    config: { responseMimeType: "application/json", responseSchema: selectionSchema(candidates.map((candidate) => candidate.caseNumber)) },
  });
  return validateSelection(parseJsonResponse(response));
}
