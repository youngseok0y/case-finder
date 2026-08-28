import fs from "node:fs/promises";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { config, ROOT_DIR } from "../config.js";
import { reserveGeminiCall } from "./rateLimiter.js";

let client = null;
let planPrompt = null;
let refinePrompt = null;
let selectPrompt = null;

const PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    queries: {
      type: Type.ARRAY,
      minItems: 4,
      maxItems: 6,
      items: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING },
          domain: { type: Type.STRING, enum: ["precedent", "constitutional", "admin_appeal"] },
          kind: { type: Type.STRING, enum: ["anchor", "support"] },
        },
        required: ["query", "domain", "kind"],
      },
    },
    law_names: { type: Type.ARRAY, items: { type: Type.STRING }, maxItems: 5 },
  },
  required: ["queries", "law_names"],
};

const SUPPORT_VALUES = Object.freeze(["direct", "related_only", "none"]);
const REFINED_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    queries: {
      type: Type.ARRAY,
      minItems: 2,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING },
          domain: { type: Type.STRING, enum: ["constitutional"] },
          kind: { type: Type.STRING, enum: ["anchor"] },
        },
        required: ["query", "domain", "kind"],
      },
    },
  },
  required: ["queries"],
};

function selectionSchema(caseNumbers) {
  const caseNumberSchema = { type: Type.STRING };
  if (caseNumbers.length > 0) caseNumberSchema.enum = caseNumbers;
  return {
    type: Type.OBJECT,
    properties: {
      support: { type: Type.STRING, enum: SUPPORT_VALUES },
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
    required: ["support", "selected", "intro"],
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
  if (name === "refine") {
    refinePrompt ||= await fs.readFile(path.join(ROOT_DIR, "prompts", "refine-plan.txt"), "utf8");
    return refinePrompt;
  }
  selectPrompt ||= await fs.readFile(path.join(ROOT_DIR, "prompts", "select.txt"), "utf8");
  return selectPrompt;
}

function fillPrompt(prompt, values) {
  return prompt
    .replace("{{USER_QUERY}}", values.query)
    .replace("{{FIRST_PASS}}", values.firstPass || "")
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

export function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.queries) || plan.queries.length < 4 || plan.queries.length > 6) {
    throw new Error("Gemini 검색계획의 queries 형식이 올바르지 않습니다.");
  }
  const queries = [];
  const seenQueries = new Set();
  for (const item of plan.queries) {
    if (!item || typeof item.query !== "string" || !item.query.trim()) continue;
    if (!["precedent", "constitutional", "admin_appeal"].includes(item.domain)) continue;
    if (!["anchor", "support"].includes(item.kind)) continue;
    const query = item.query.trim();
    const key = `${query}\u0000${item.domain}\u0000${item.kind}`;
    if (seenQueries.has(key)) continue;
    seenQueries.add(key);
    queries.push({ query, domain: item.domain, kind: item.kind });
  }
  const lawNames = [...new Set((Array.isArray(plan.law_names) ? plan.law_names : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))].slice(0, 5);
  const anchorCount = queries.filter((item) => item.kind === "anchor").length;
  const supportCount = queries.filter((item) => item.kind === "support").length;
  if (queries.length < 4 || queries.length > 6 || anchorCount < 2 || supportCount === 0) {
    throw new Error("Gemini 검색계획은 2개 이상의 anchor와 1개 이상의 support가 필요합니다.");
  }
  return { queries, law_names: lawNames };
}

function normalizeRefinementQuery(value) {
  return String(value || "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ko-KR");
}

function containsCaseNumber(value) {
  return /\d{2,4}\s*(?:헌가|헌나|헌다|헌라|헌마|헌바|헌사|헌아|헌자|헌카|헌타|헌파)\s*\d+/u.test(value)
    || /\d{2,4}\s*[가-힣]{1,2}\s*\d{1,8}/u.test(value);
}

export function buildRefinementInput(query, firstPass = []) {
  return {
    user_query: query,
    first_pass: (Array.isArray(firstPass) ? firstPass : []).map((entry) => ({
      query: String(entry?.query || "").trim(),
      domain: String(entry?.domain || "").trim(),
      kind: String(entry?.kind || "").trim(),
      result_count: Number.isInteger(entry?.result_count)
        ? entry.result_count
        : Number.isInteger(entry?.exposed_result_count) ? entry.exposed_result_count : 0,
      is_error: Boolean(entry?.is_error),
    })),
  };
}

export function validateRefinedPlan(plan, firstPass = []) {
  if (!plan || !Array.isArray(plan.queries)) {
    throw new Error("Gemini refined 검색계획의 queries 형식이 올바르지 않습니다.");
  }
  const firstPassQueries = new Set(
    (Array.isArray(firstPass) ? firstPass : [])
      .map((entry) => normalizeRefinementQuery(entry?.query))
      .filter(Boolean),
  );
  const seenQueries = new Set();
  const queries = [];
  for (const item of plan.queries) {
    if (!item || typeof item.query !== "string") continue;
    const query = item.query.trim();
    const normalized = normalizeRefinementQuery(query);
    if (!normalized || item.domain !== "constitutional" || item.kind !== "anchor") continue;
    if (containsCaseNumber(query) || firstPassQueries.has(normalized) || seenQueries.has(normalized)) continue;
    seenQueries.add(normalized);
    queries.push({ query, domain: "constitutional", kind: "anchor" });
  }
  if (queries.length < 2) {
    throw new Error("Gemini refined 검색계획은 중복을 제외하고 2개 이상의 constitutional anchor가 필요합니다.");
  }
  return { queries: queries.slice(0, 3), law_names: [] };
}

export function validateSelection(selection) {
  if (!selection || !Array.isArray(selection.selected)) throw new Error("Gemini 선별 응답의 selected 형식이 올바르지 않습니다.");
  const intro = typeof selection.intro === "string" ? selection.intro.trim() : "";
  const selected = selection.selected
    .slice(0, config.resultMax)
    .filter((item) => item && typeof item.case_no === "string" && (item.match === "direct" || item.match === "related"));
  const support = SUPPORT_VALUES.includes(selection.support) ? selection.support : "none";
  if (support === "none") return { support, selected: [], intro };
  if (support === "related_only") {
    return {
      support,
      selected: selected.map((item) => ({ ...item, match: "related" })),
      intro,
    };
  }
  if (!selected.some((item) => item.match === "direct")) {
    return selected.length > 0
      ? { support: "related_only", selected: selected.map((item) => ({ ...item, match: "related" })), intro }
      : { support: "none", selected: [], intro };
  }
  return { support, selected, intro };
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

export async function generateRefinedPlan(query, firstPass, telemetry = null, options = {}) {
  const generate = options.generateContent || generateContent;
  const input = buildRefinementInput(query, firstPass);
  const response = await generate({
    model: config.geminiModel,
    contents: fillPrompt(await getPrompt("refine"), {
      query,
      firstPass: JSON.stringify(input),
    }),
    config: { responseMimeType: "application/json", responseSchema: REFINED_PLAN_SCHEMA },
  }, { telemetry });
  return validateRefinedPlan(parseJsonResponse(response), input.first_pass);
}

export async function selectCandidates(query, candidates, telemetry = null) {
  if (candidates.length === 0) return { support: "none", selected: [], intro: "" };
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
