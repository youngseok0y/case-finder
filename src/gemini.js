import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { config, ROOT_DIR } from "../config.js";
import { reserveGeminiCall } from "./rateLimiter.js";

let client = null;
let planPrompt = null;
let selectPrompt = null;

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

function isRateLimitError(error) {
  const status = error?.status ?? error?.statusCode;
  const message = String(error?.message || error || "");
  return status === 429 || /\b429\b|resource exhausted|rate limit|quota/i.test(message);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function recordGeminiAttempt(telemetry, response, isRetry) {
  if (!telemetry) return;
  telemetry.geminiRequests = (telemetry.geminiRequests || 0) + 1;
  telemetry.geminiRetryRequests = (telemetry.geminiRetryRequests || 0) + (isRetry ? 1 : 0);
  const usage = response?.usageMetadata || {};
  telemetry.geminiInputTokens = (telemetry.geminiInputTokens || 0) + Number(usage.promptTokenCount || usage.inputTokenCount || 0);
  telemetry.geminiOutputTokens = (telemetry.geminiOutputTokens || 0) + Number(usage.candidatesTokenCount || usage.outputTokenCount || 0);
}

export async function generateContent(request, options = {}) {
  const ai = options.generate ? null : await getClient();
  const generate = options.generate || ((payload) => ai.models.generateContent(payload));
  const reserveCall = options.reserveGeminiCall || reserveGeminiCall;
  const waitForRetry = options.sleep || wait;
  const retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : config.geminiRetryDelayMs;
  await reserveCall(Date.now(), options);
  try {
    const response = await generate(request);
    recordGeminiAttempt(options.telemetry, response, false);
    return options.returnMeta ? { response, callsUsed: 1 } : response;
  } catch (error) {
    if (!isRateLimitError(error)) {
      recordGeminiAttempt(options.telemetry, null, false);
      throw error;
    }
    recordGeminiAttempt(options.telemetry, null, false);
    await waitForRetry(retryDelayMs);
    const retryOptions = Number.isInteger(options.questionCalls)
      ? { ...options, questionCalls: options.questionCalls + 1 }
      : options;
    await reserveCall(Date.now(), retryOptions);
    try {
      const response = await generate(request);
      recordGeminiAttempt(options.telemetry, response, true);
      return options.returnMeta ? { response, callsUsed: 2 } : response;
    } catch (retryError) {
      recordGeminiAttempt(options.telemetry, null, true);
      throw retryError;
    }
  }
}

export async function generatePlan(query, telemetry = null) {
  const response = await generateContent({
    model: config.geminiModel,
    contents: fillPrompt(await getPrompt("plan"), { query }),
    config: { responseMimeType: "application/json", responseSchema: PLAN_SCHEMA },
  }, { telemetry });
  return validatePlan(parseJsonResponse(response));
}

export async function selectCandidates(query, candidates, telemetry = null) {
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
  }, { telemetry });
  return validateSelection(parseJsonResponse(response));
}
