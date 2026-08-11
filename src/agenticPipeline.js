import { config } from "../config.js";
import { callTool } from "./mcpClient.js";
import {
  parseDecisionDetail,
  parseDecisionSearchResults,
  toolText,
} from "./directLookup.js";
import { caseNumberIncludes, caseNumberKey, normalizeCaseNumber } from "./router.js";
import { generateAgenticTurn, parseSelectionResponse } from "./gemini.js";
import { GeminiLimitExceededError } from "./rateLimiter.js";
import {
  finalizeSelection,
  getFallbackLabel,
  collectCandidates,
  fallbackPlan,
  lookupQueryLawReferences,
  prepareCandidates,
} from "./nlPipeline.js";

const DECISION_DOMAINS = new Set(["precedent", "constitutional"]);
const TOOL_NAMES = new Set(["search_decisions", "search_law", "get_law_text", "get_decision_text"]);

function toolError(message) {
  return {
    isError: true,
    content: [{ type: "text", text: `[AGENTIC_TOOL_ERROR] ${message}` }],
  };
}

function integerOr(value, fallback, minimum, maximum) {
  const number = Number.isInteger(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function executeAgenticTool(name, rawArgs) {
  if (!TOOL_NAMES.has(name)) return toolError(`허용되지 않은 도구입니다: ${name || "(이름 없음)"}`);
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {};

  if (name === "search_decisions") {
    const domain = stringValue(args.domain);
    const query = stringValue(args.query);
    if (!DECISION_DOMAINS.has(domain) || !query) return toolError("search_decisions에는 허용된 domain과 query가 필요합니다.");
    return callTool(name, {
      domain,
      query,
      display: integerOr(args.display, config.searchDisplay, 1, config.searchDisplay),
    });
  }

  if (name === "search_law") {
    const query = stringValue(args.query);
    if (!query) return toolError("search_law에는 query가 필요합니다.");
    return callTool(name, {
      query,
      display: integerOr(args.display, config.lawSearchDisplay, 1, config.lawSearchDisplay),
    });
  }

  if (name === "get_law_text") {
    const mst = stringValue(args.mst);
    const lawId = stringValue(args.lawId);
    if (!mst && !lawId) return toolError("get_law_text에는 mst 또는 lawId가 필요합니다.");
    const callArgs = {};
    if (mst) callArgs.mst = mst;
    if (lawId) callArgs.lawId = lawId;
    const jo = stringValue(args.jo);
    if (jo) callArgs.jo = jo;
    return callTool(name, callArgs);
  }

  const domain = stringValue(args.domain);
  const id = stringValue(args.id);
  if (!DECISION_DOMAINS.has(domain) || !id) return toolError("get_decision_text에는 허용된 domain과 id가 필요합니다.");
  return callTool(name, { domain, id, full: false });
}

function rememberCandidate(candidates, item, domain, searchQuery) {
  const caseNumber = normalizeCaseNumber(item.caseNumber);
  if (!caseNumber) return;
  const key = caseNumberKey(caseNumber);
  const existing = candidates.get(key);
  if (existing) {
    existing.matchedKeywords.add(searchQuery);
    existing.title ||= item.title;
    existing.court ||= item.court;
    existing.date ||= item.date;
    existing.link ||= item.link;
    existing.id ||= item.id;
    existing.domain ||= domain;
    return;
  }
  candidates.set(key, {
    ...item,
    caseNumber,
    domain,
    matchedKeywords: new Set([searchQuery]),
  });
}

function observeDecisionResult(candidates, result, args, searchQuery) {
  const text = toolText(result);
  if (!text || result?.isError) return;
  for (const item of parseDecisionSearchResults(text)) {
    rememberCandidate(candidates, item, args.domain, searchQuery);
  }
  const detail = parseDecisionDetail(text);
  const caseNumber = normalizeCaseNumber(detail.caseNumber);
  if (!caseNumber) return;
  const existing = candidates.get(caseNumberKey(caseNumber));
  if (existing) {
    existing.prefetched = {
      result,
      text,
      detail,
      valid: !text.includes("[NOT_FOUND]")
        && !text.includes("[HALLUCINATION_DETECTED]")
        && caseNumberIncludes(detail.caseNumber, existing.caseNumber),
    };
    existing.court ||= detail.court;
    existing.date ||= detail.date;
    existing.caseType ||= detail.caseType;
    existing.type ||= detail.type;
    existing.preview ||= detail.sections?.판시사항?.slice(0, 300) || "";
    return;
  }
  rememberCandidate(candidates, {
    id: stringValue(args.id),
    title: caseNumber,
    caseNumber,
    court: detail.court,
    date: detail.date,
    caseType: detail.caseType,
    type: detail.type,
    link: "",
  }, args.domain, searchQuery);
  const created = candidates.get(caseNumberKey(caseNumber));
  created.prefetched = {
    result,
    text,
    detail,
    valid: !text.includes("[NOT_FOUND]")
      && !text.includes("[HALLUCINATION_DETECTED]")
      && caseNumberIncludes(detail.caseNumber, created.caseNumber),
  };
  created.preview = detail.sections?.판시사항?.slice(0, 300) || "";
}

function observeToolResult(candidates, name, result, args) {
  if (name !== "search_decisions" && name !== "get_decision_text") return;
  observeDecisionResult(candidates, result, args, stringValue(args.query) || "agentic");
}

function functionResponsePart(call, result) {
  const text = toolText(result).slice(0, config.agenticToolResultMaxChars);
  return {
    functionResponse: {
      name: call.name,
      id: call.id,
      response: {
        output: {
          isError: Boolean(result?.isError),
          text,
        },
      },
    },
  };
}

export async function runAgenticSearch(query) {
  const contents = [{ role: "user", parts: [{ text: query }] }];
  const candidates = new Map();
  let selection = null;

  try {
    let questionCalls = 0;
    while (questionCalls < config.agenticCallMax) {
      const turn = await generateAgenticTurn(contents, [...candidates.keys()], questionCalls);
      questionCalls += turn.callsUsed;
      const response = turn.response;
      const functionCalls = response.functionCalls || [];
      if (functionCalls.length === 0) {
        selection = parseSelectionResponse(response);
        break;
      }

      const modelTurn = response.candidates?.[0]?.content || {
        role: "model",
        parts: functionCalls.map((call) => ({ functionCall: call })),
      };
      contents.push(modelTurn);
      const toolResults = await Promise.all(functionCalls.map(async (call) => {
        const result = await executeAgenticTool(call.name, call.args);
        observeToolResult(candidates, call.name, result, call.args || {});
        return { call, result };
      }));
      contents.push({
        role: "user",
        parts: toolResults.map(({ call, result }) => functionResponsePart(call, result)),
      });
    }
  } catch (error) {
    error.observedCandidates = [...candidates.values()];
    throw error;
  }

  if (!selection) return {
    selection: { selected: [], intro: "" },
    candidates: [...candidates.values()],
    limitReached: true,
  };
  return { selection, candidates: [...candidates.values()], limitReached: false };
}

export async function runAgenticPipeline(query) {
  let search;
  let fallbackLabel = "";
  try {
    search = await runAgenticSearch(query);
  } catch (error) {
    const observedCandidates = error.observedCandidates || [];
    const fallbackCandidates = observedCandidates.length > 0
      ? observedCandidates
      : await collectCandidates(fallbackPlan(query));
    search = { selection: { selected: [], intro: "" }, candidates: fallbackCandidates };
    fallbackLabel = getFallbackLabel(error);
  }

  if (search.limitReached) {
    fallbackLabel = getFallbackLabel(new GeminiLimitExceededError("질문당 한도"));
    if (search.candidates.length === 0) search.candidates = await collectCandidates(fallbackPlan(query));
  }

  const prepared = await prepareCandidates(search.candidates);
  const lawReferences = await lookupQueryLawReferences(query);
  if (prepared.candidatesWithPreview.length === 0 && search.candidates.length === 0) {
    return {
      route: "natural",
      query,
      intro: "",
      fallbackLabel,
      lawReferences,
      candidateCaseNumbers: [],
      selected: [],
      items: [],
    };
  }

  return finalizeSelection({
    query,
    candidatesWithPreview: prepared.candidatesWithPreview,
    candidatePool: search.candidates,
    selection: search.selection,
    fallbackLabel,
    lawReferences,
  });
}
