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
  selectPrompt ||= await fs.readFile(path.join(ROOT_DIR, "prompts", "select.txt"), "utf8");
  return selectPrompt;
}

export function fillPrompt(prompt, values) {
  return prompt
    .replace("{{USER_QUERY}}", () => values.query)
    .replace("{{FIRST_PASS}}", () => values.firstPass || "")
    .replace("{{CANDIDATES}}", () => values.candidates || "");
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

function waitWithAbort(milliseconds, signal) {
  if (!signal) return wait(milliseconds);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortedError());
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function recordGeminiAttempt(telemetry, response, isRetry) {
  if (!telemetry) return;
  telemetry.geminiRequests = (telemetry.geminiRequests || 0) + 1;
  telemetry.geminiRetryRequests = (telemetry.geminiRetryRequests || 0) + (isRetry ? 1 : 0);
  const usage = response?.usageMetadata || {};
  telemetry.geminiInputTokens = (telemetry.geminiInputTokens || 0) + Number(usage.promptTokenCount || usage.inputTokenCount || 0);
  telemetry.geminiOutputTokens = (telemetry.geminiOutputTokens || 0) + Number(usage.candidatesTokenCount || usage.outputTokenCount || 0);
}

function abortedError() {
  const error = new Error("Gemini 호출이 취소되었습니다.");
  error.code = "ABORTED";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortedError();
}

async function callGeminiModel(ai, request, abortSignal) {
  throwIfAborted(abortSignal);
  const response = await ai.models.generateContent(request);
  throwIfAborted(abortSignal);
  return response;
}

async function generateContent(request, { telemetry = null, abortSignal = null } = {}) {
  throwIfAborted(abortSignal);
  const ai = await getClient();
  const requestWithAbort = abortSignal
    ? { ...request, config: { ...request.config, abortSignal } }
    : request;
  await reserveGeminiCall(Date.now(), { telemetry, abortSignal });
  throwIfAborted(abortSignal);
  try {
    const response = await callGeminiModel(ai, requestWithAbort, abortSignal);
    recordGeminiAttempt(telemetry, response, false);
    return response;
  } catch (error) {
    if (!isRateLimitError(error)) {
      recordGeminiAttempt(telemetry, null, false);
      throw error;
    }
    recordGeminiAttempt(telemetry, null, false);
    await waitWithAbort(config.geminiRetryDelayMs, abortSignal);
    throwIfAborted(abortSignal);
    await reserveGeminiCall(Date.now(), { telemetry, abortSignal });
    throwIfAborted(abortSignal);
    try {
      const response = await callGeminiModel(ai, requestWithAbort, abortSignal);
      recordGeminiAttempt(telemetry, response, true);
      return response;
    } catch (retryError) {
      recordGeminiAttempt(telemetry, null, true);
      throw retryError;
    }
  }
}

export async function generatePlan(query, telemetry = null) {
  const response = await generateContent({
    model: config.geminiModel,
    contents: fillPrompt(await getPrompt("plan"), { query }),
    config: { responseMimeType: "application/json", responseSchema: PLAN_SCHEMA },
  }, { telemetry, abortSignal: telemetry?.abortSignal });
  return validatePlan(parseJsonResponse(response));
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
  }, { telemetry, abortSignal: telemetry?.abortSignal });
  return validateSelection(parseJsonResponse(response));
}
