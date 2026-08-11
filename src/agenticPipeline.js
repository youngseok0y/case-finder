import { config } from "../config.js";
import { callTool } from "./mcpClient.js";
import {
  parseDecisionDetail,
  parseLawSearchResults,
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

const DECISION_DOMAINS = new Set(["precedent", "constitutional", "admin_appeal"]);
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

function parseTotal(text, fallback) {
  const match = String(text || "").match(/총\s*(\d+)\s*건/u);
  return match ? Number.parseInt(match[1], 10) : fallback;
}

function compactSearchItem(item) {
  return {
    id: item.id,
    caseNumber: item.caseNumber,
    title: item.title,
    court: item.court,
    date: item.date,
    caseType: item.caseType || "",
    type: item.type || "",
  };
}

const DETAIL_SECTIONS_FOR_AGENT = ["판시사항", "판결요지", "결정요지", "재결주문", "재결요지"];

export function structureAgenticToolResult(name, result) {
  const text = toolText(result);
  const isError = Boolean(result?.isError);
  const hasNotFound = text.includes("[NOT_FOUND]") || text.includes("[HALLUCINATION_DETECTED]");

  if (name === "search_decisions") {
    const items = parseDecisionSearchResults(text).map(compactSearchItem);
    const output = { isError: isError || hasNotFound, total: parseTotal(text, items.length), items };
    if (output.isError) output.message = text;
    return output;
  }

  if (name === "search_law") {
    const items = parseLawSearchResults(text).map((item) => ({
      title: item.title,
      lawId: item.lawId,
      mst: item.mst,
    }));
    const output = { isError: isError || hasNotFound, total: parseTotal(text, items.length), items };
    if (output.isError) output.message = text;
    return output;
  }

  if (name === "get_decision_text") {
    const detail = parseDecisionDetail(text);
    const sections = Object.fromEntries(
      DETAIL_SECTIONS_FOR_AGENT
        .filter((section) => detail.sections[section])
        .map((section) => [section, detail.sections[section]]),
    );
    const output = {
      isError: isError || hasNotFound,
      caseNumber: detail.caseNumber,
      court: detail.court,
      date: detail.date,
      caseType: detail.caseType,
      type: detail.type,
      sections,
    };
    if (output.isError) output.message = text;
    return output;
  }

  return { isError, text };
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
      options: domain === "precedent" ? { search: 2 } : undefined,
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
  return {
    functionResponse: {
      name: call.name,
      id: call.id,
      response: {
        output: structureAgenticToolResult(call.name, result),
      },
    },
  };
}

function serializeCandidate(candidate) {
  return {
    id: candidate.id,
    caseNumber: candidate.caseNumber,
    title: candidate.title,
    court: candidate.court,
    date: candidate.date,
    caseType: candidate.caseType || "",
    type: candidate.type || "",
    domain: candidate.domain,
    matchedKeywords: [...(candidate.matchedKeywords || [])],
    preview: candidate.preview || "",
  };
}

function serializeSelection(selection) {
  if (!selection) return null;
  return {
    selected: (selection.selected || []).map((item) => ({ case_no: item.case_no, match: item.match })),
    intro: selection.intro || "",
  };
}

export async function runAgenticSearch(query) {
  const contents = [{ role: "user", parts: [{ text: query }] }];
  const candidates = new Map();
  let selection = null;
  let questionCalls = 0;
  let stopReason = "call_limit";

  try {
    while (questionCalls < config.agenticCallMax) {
      const turn = await generateAgenticTurn(contents, [...candidates.keys()], questionCalls);
      questionCalls += turn.callsUsed;
      const response = turn.response;
      const functionCalls = response.functionCalls || [];
      if (functionCalls.length === 0) {
        selection = parseSelectionResponse(response);
        stopReason = "completed";
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
    error.observedSelection = selection;
    error.agentStopReason = "error";
    error.agentCallsUsed = questionCalls;
    throw error;
  }

  if (!selection) return {
    selection: { selected: [], intro: "" },
    candidates: [...candidates.values()],
    limitReached: true,
    stopReason,
    callsUsed: questionCalls,
  };
  return { selection, candidates: [...candidates.values()], limitReached: false, stopReason, callsUsed: questionCalls };
}

export async function runAgenticPipeline(query) {
  let search;
  let fallbackLabel = "";
  let rawAgentCandidates = [];
  let rawAgentSelection = null;
  let agentStopReason = "error";
  const fallbackReasons = [];
  try {
    search = await runAgenticSearch(query);
    rawAgentCandidates = search.candidates;
    rawAgentSelection = search.selection;
    agentStopReason = search.stopReason;
  } catch (error) {
    const observedCandidates = error.observedCandidates || [];
    rawAgentCandidates = observedCandidates;
    rawAgentSelection = error.observedSelection || null;
    agentStopReason = error.agentStopReason || "error";
    const fallbackCandidates = observedCandidates.length > 0
      ? observedCandidates
      : await collectCandidates(fallbackPlan(query));
    if (observedCandidates.length === 0) fallbackReasons.push("deterministic_candidates");
    search = { selection: { selected: [], intro: "" }, candidates: fallbackCandidates };
    fallbackLabel = getFallbackLabel(error);
  }

  if (search.limitReached) {
    fallbackLabel = getFallbackLabel(new GeminiLimitExceededError("질문당 한도"));
    if (search.candidates.length === 0) {
      search.candidates = await collectCandidates(fallbackPlan(query));
      fallbackReasons.push("deterministic_candidates");
    }
  }

  if ((search.selection?.selected || []).length === 0) fallbackReasons.push("ranked_fill");

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
      raw_agent_candidates: rawAgentCandidates.map(serializeCandidate),
      raw_agent_selection: serializeSelection(rawAgentSelection),
      agent_stop_reason: agentStopReason,
      fallback_used: fallbackReasons.length > 0,
      fallback_reason: [...new Set(fallbackReasons)],
      final_product_output: null,
    };
  }

  const finalResult = await finalizeSelection({
    query,
    candidatesWithPreview: prepared.candidatesWithPreview,
    candidatePool: search.candidates,
    selection: search.selection,
    fallbackLabel,
    lawReferences,
  });
  return {
    ...finalResult,
    raw_agent_candidates: rawAgentCandidates.map(serializeCandidate),
    raw_agent_selection: serializeSelection(rawAgentSelection),
    agent_stop_reason: agentStopReason,
    fallback_used: fallbackReasons.length > 0,
    fallback_reason: [...new Set(fallbackReasons)],
    final_product_output: null,
  };
}
