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

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function responseTokenCounts(response) {
  const usage = response?.usageMetadata || {};
  return {
    inputTokens: Number(usage.promptTokenCount || usage.inputTokenCount || 0),
    outputTokens: Number(usage.candidatesTokenCount || usage.outputTokenCount || 0),
  };
}

function decisionNumbersFromResult(name, result) {
  const text = toolText(result);
  if (name === "search_decisions") return parseDecisionSearchResults(text).map((item) => item.caseNumber).filter(Boolean);
  if (name === "get_decision_text") {
    const caseNumber = parseDecisionDetail(text).caseNumber;
    return caseNumber ? [caseNumber] : [];
  }
  return [];
}

function createAgenticTrace() {
  return {
    events: [],
    metrics: {
      geminiRequests: 0,
      geminiRetryRequests: 0,
      geminiInputTokens: 0,
      geminiOutputTokens: 0,
      mcpCallsTotal: 0,
      mcpSearchCalls: 0,
      mcpDetailCalls: 0,
      elapsedMs: 0,
    },
  };
}

function publicAgentMetrics(metrics, stopReason, fallbackUsed) {
  if (!metrics) return null;
  return {
    gemini_requests: metrics.geminiRequests || 0,
    gemini_retry_requests: metrics.geminiRetryRequests || 0,
    gemini_input_tokens: metrics.geminiInputTokens || 0,
    gemini_output_tokens: metrics.geminiOutputTokens || 0,
    mcp_calls_total: metrics.mcpCallsTotal || 0,
    mcp_search_calls: metrics.mcpSearchCalls || 0,
    mcp_detail_calls: metrics.mcpDetailCalls || 0,
    elapsed_ms: metrics.elapsedMs || 0,
    stop_reason: stopReason,
    fallback_used: Boolean(fallbackUsed),
  };
}

function classifyAgentError(error) {
  const reason = String(error?.reason || "");
  if (error?.code === "GEMINI_LIMIT_EXCEEDED") {
    if (/reserve/u.test(reason)) return "RPD_RESERVE_STOP";
    if (/일일|daily|rpd/i.test(reason)) return "RPD_LIMIT_STOP";
    if (/분당|rpm|minute/i.test(reason)) return "RPM_LIMIT_STOP";
    return "GEMINI_LIMIT_STOP";
  }
  return "ERROR";
}

export async function runAgenticSearch(query) {
  const contents = [{ role: "user", parts: [{ text: query }] }];
  const candidates = new Map();
  const toolCache = new Map();
  const seenSearchCalls = new Set();
  const seenDetailCalls = new Set();
  const trace = createAgenticTrace();
  const startedAt = Date.now();
  const openHorizon = config.agenticMode === "open";
  let selection = null;
  let questionCalls = 0;
  let stopReason = openHorizon ? "SAFETY_WATCHDOG_STOP" : "QUESTION_CALL_LIMIT";
  let noNewEvidenceTurns = 0;

  try {
    while (true) {
      if (Date.now() - startedAt >= config.aoWallClockMaxMs) {
        stopReason = "SAFETY_WATCHDOG_STOP";
        break;
      }
      if (!openHorizon && questionCalls >= config.agenticCallMax) {
        stopReason = "QUESTION_CALL_LIMIT";
        break;
      }

      const turn = await generateAgenticTurn(
        contents,
        [...candidates.keys()],
        questionCalls,
        {
          enforceQuestionLimit: !openHorizon,
          rpdReserve: openHorizon ? config.aoRpdReserve : 0,
        },
      );
      questionCalls += turn.callsUsed;
      trace.metrics.geminiRequests += turn.callsUsed;
      trace.metrics.geminiRetryRequests += Math.max(0, turn.callsUsed - 1);
      const tokenCounts = responseTokenCounts(turn.response);
      trace.metrics.geminiInputTokens += tokenCounts.inputTokens;
      trace.metrics.geminiOutputTokens += tokenCounts.outputTokens;
      const response = turn.response;
      const functionCalls = response.functionCalls || [];
      if (functionCalls.length === 0) {
        selection = parseSelectionResponse(response);
        stopReason = "MODEL_FINAL";
        break;
      }

      const modelTurn = response.candidates?.[0]?.content || {
        role: "model",
        parts: functionCalls.map((call) => ({ functionCall: call })),
      };
      contents.push(modelTurn);
      const candidatesBeforeTurn = candidates.size;
      const evidenceCallsBeforeTurn = seenSearchCalls.size + seenDetailCalls.size;
      const toolResults = [];
      for (const [callIndex, call] of functionCalls.entries()) {
        const callStartedAt = Date.now();
        const candidatesBeforeCall = candidates.size;
        const args = call.args || {};
        const cacheKey = canonicalize({ name: call.name, args });
        const cacheHit = toolCache.has(cacheKey);
        const result = cacheHit ? toolCache.get(cacheKey) : await executeAgenticTool(call.name, args);
        if (!cacheHit) {
          toolCache.set(cacheKey, result);
          trace.metrics.mcpCallsTotal += 1;
          if (call.name === "search_decisions" || call.name === "search_law") trace.metrics.mcpSearchCalls += 1;
          if (call.name === "get_decision_text" || call.name === "get_law_text") trace.metrics.mcpDetailCalls += 1;
        }
        observeToolResult(candidates, call.name, result, args);
        const resultText = toolText(result);
        const isUsable = !result?.isError
          && !resultText.includes("[NOT_FOUND]")
          && !resultText.includes("[HALLUCINATION_DETECTED]");
        if (!cacheHit && (call.name === "search_decisions" || call.name === "search_law")) {
          seenSearchCalls.add(cacheKey);
        }
        if (!cacheHit && (call.name === "get_decision_text" || call.name === "get_law_text")) {
          seenDetailCalls.add(cacheKey);
        }
        const returnedCaseNumbers = decisionNumbersFromResult(call.name, result);
        trace.events.push({
          question_id: query,
          arm: openHorizon ? "AO" : "A6",
          gemini_request_index: questionCalls,
          tool_call_index: trace.metrics.mcpCallsTotal,
          tool: call.name,
          query: args.query || "",
          returned_case_numbers: returnedCaseNumbers,
          new_case_number_count: Math.max(0, candidates.size - candidatesBeforeCall),
          opened_case_number: call.name === "get_decision_text" ? returnedCaseNumbers[0] || null : null,
          candidate_gold_seen: null,
          selected_gold_seen: null,
          input_tokens: callIndex === 0 ? tokenCounts.inputTokens : 0,
          output_tokens: callIndex === 0 ? tokenCounts.outputTokens : 0,
          elapsed_ms: Date.now() - callStartedAt,
          cache_hit: cacheHit,
        });
        toolResults.push({ call, result });
      }
      contents.push({
        role: "user",
        parts: toolResults.map(({ call, result }) => functionResponsePart(call, result)),
      });

      const newEvidence = candidates.size > candidatesBeforeTurn
        || seenSearchCalls.size + seenDetailCalls.size > evidenceCallsBeforeTurn;
      noNewEvidenceTurns = newEvidence ? 0 : noNewEvidenceTurns + 1;
      if (openHorizon && noNewEvidenceTurns >= config.aoNoNewEvidenceTurns) {
        stopReason = "NO_NEW_EVIDENCE";
        break;
      }
    }
  } catch (error) {
    error.observedCandidates = [...candidates.values()];
    error.observedSelection = selection;
    error.agentStopReason = error?.code === "GEMINI_LIMIT_EXCEEDED" && /reserve|일일/u.test(String(error.reason || error.message))
      ? "RPD_RESERVE_STOP"
      : "ERROR";
    error.agentCallsUsed = questionCalls;
    trace.metrics.elapsedMs = Date.now() - startedAt;
    error.agentTrace = trace;
    throw error;
  }

  trace.metrics.elapsedMs = Date.now() - startedAt;
  if (!selection) return {
    selection: { selected: [], intro: "" },
    candidates: [...candidates.values()],
    limitReached: true,
    stopReason,
    callsUsed: questionCalls,
    trace,
  };
  return { selection, candidates: [...candidates.values()], limitReached: false, stopReason, callsUsed: questionCalls, trace };
}

export async function runAgenticPipeline(query) {
  let search;
  let fallbackLabel = "";
  let rawAgentCandidates = [];
  let rawAgentSelection = null;
  let agentStopReason = "ERROR";
  let agentTrace = null;
  let agentErrorReason = null;
  let fallbackCandidateSet = [];
  const fallbackReasons = [];
  try {
    search = await runAgenticSearch(query);
    rawAgentCandidates = search.candidates;
    rawAgentSelection = search.selection;
    agentStopReason = search.stopReason;
    agentTrace = search.trace;
  } catch (error) {
    const observedCandidates = error.observedCandidates || [];
    rawAgentCandidates = observedCandidates;
    rawAgentSelection = error.observedSelection || null;
    agentStopReason = error.agentStopReason || classifyAgentError(error);
    agentErrorReason = error.reason || null;
    agentTrace = error.agentTrace || null;
    const fallbackCandidates = observedCandidates.length > 0
      ? observedCandidates
      : await collectCandidates(fallbackPlan(query));
    if (observedCandidates.length === 0) {
      fallbackCandidateSet = fallbackCandidates;
      fallbackReasons.push("deterministic_candidates");
    }
    search = { selection: { selected: [], intro: "" }, candidates: fallbackCandidates };
    fallbackLabel = getFallbackLabel(error);
  }

  if (search.limitReached) {
    if (agentStopReason === "QUESTION_CALL_LIMIT") {
      fallbackLabel = getFallbackLabel(new GeminiLimitExceededError("질문당 한도"));
    }
    if (search.candidates.length === 0) {
      search.candidates = await collectCandidates(fallbackPlan(query));
      fallbackCandidateSet = search.candidates;
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
      agent_error_reason: agentErrorReason,
      fallback_used: fallbackReasons.length > 0,
      fallback_reason: [...new Set(fallbackReasons)],
      raw_agent_candidate_set: rawAgentCandidates.map(serializeCandidate),
      fallback_candidate_set: fallbackCandidateSet.map(serializeCandidate),
      agent_metrics: publicAgentMetrics(agentTrace?.metrics, agentStopReason, fallbackReasons.length > 0),
      agent_events: agentTrace?.events || [],
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
    agent_error_reason: agentErrorReason,
    fallback_used: fallbackReasons.length > 0,
    fallback_reason: [...new Set(fallbackReasons)],
    raw_agent_candidate_set: rawAgentCandidates.map(serializeCandidate),
    fallback_candidate_set: fallbackCandidateSet.map(serializeCandidate),
    agent_metrics: publicAgentMetrics(agentTrace?.metrics, agentStopReason, fallbackReasons.length > 0),
    agent_events: agentTrace?.events || [],
    final_product_output: null,
  };
}
