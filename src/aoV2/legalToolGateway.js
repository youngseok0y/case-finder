import { config } from "../../config.js";
import { callTool as defaultCallTool } from "../mcpClient.js";
import { parseDecisionDetail, parseDecisionSearchResults, parseLawSearchResults, toolText } from "../directLookup.js";
import { createEvidenceLedger } from "./evidenceLedger.js";
import { createSafetyController } from "./safety.js";
import { createTelemetry } from "./telemetry.js";

export const LEGAL_TOOL_NAMES = Object.freeze([
  "search_decisions",
  "search_law",
  "get_decision_text",
  "get_law_text",
]);

const DECISION_DOMAINS = new Set(["precedent", "constitutional", "admin_appeal"]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function integerOr(value, fallback, minimum, maximum) {
  const number = Number.isInteger(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function errorResult(code, message, details = {}) {
  return {
    isError: true,
    code,
    message,
    ...details,
  };
}

function hasNotFound(raw) {
  const value = toolText(raw);
  return value.includes("[NOT_FOUND]") || value.includes("[HALLUCINATION_DETECTED]");
}

export function normalizeLegalToolResult(name, raw) {
  const rawText = toolText(raw);
  const isError = Boolean(raw?.isError) || hasNotFound(raw);
  if (name === "search_decisions") {
    const items = parseDecisionSearchResults(rawText).map((item) => ({
      id: item.id,
      caseNumber: item.caseNumber,
      title: item.title,
      court: item.court,
      date: item.date,
      caseType: item.caseType || "",
      type: item.type || "",
    }));
    return { isError, total: items.length, items, rawText };
  }
  if (name === "search_law") {
    const items = parseLawSearchResults(rawText).map((item) => ({
      title: item.title,
      lawId: item.lawId,
      mst: item.mst,
    }));
    return { isError, total: items.length, items, rawText };
  }
  if (name === "get_decision_text") {
    const detail = parseDecisionDetail(rawText);
    return {
      isError,
      caseNumber: detail.caseNumber,
      court: detail.court,
      date: detail.date,
      caseType: detail.caseType,
      type: detail.type,
      sections: detail.sections || {},
      rawText,
    };
  }
  if (name === "get_law_text") return { isError, rawText };
  return errorResult("UNKNOWN_TOOL", `Unsupported legal tool: ${name}`);
}

function decisionArguments(args) {
  const domain = text(args?.domain);
  const query = text(args?.query);
  if (!DECISION_DOMAINS.has(domain)) return errorResult("INVALID_ARGUMENT", "search_decisions requires an allowed domain.");
  if (!query) return errorResult("EMPTY_QUERY_REJECTED", "search_decisions query must not be empty.");
  return {
    domain,
    query,
    display: integerOr(args?.display, config.searchDisplay, 1, config.searchDisplay),
    ...(domain === "precedent" ? { options: { search: 2 } } : {}),
  };
}

export class LegalToolGateway {
  constructor({
    callTool = defaultCallTool,
    normalizeResult = normalizeLegalToolResult,
    ledger = createEvidenceLedger(),
    telemetry = createTelemetry({ provider: "unknown" }),
    safety = createSafetyController(),
  } = {}) {
    this.callTool = callTool;
    this.normalizeResult = normalizeResult;
    this.ledger = ledger;
    this.telemetry = telemetry;
    this.safety = safety;
    this.trace = [];
  }

  toolNames() {
    return [...LEGAL_TOOL_NAMES];
  }

  toolDefinitions() {
    return LEGAL_TOOL_NAMES.map((name) => ({ name, kind: "legal", restricted: true }));
  }

  reject(code, message) {
    this.trace.push({ accepted: false, code, message });
    this.telemetry.recordToolCall("", { rejected: true, errorCode: code });
    return errorResult(code, message);
  }

  async execute(name, rawArgs = {}) {
    if (!LEGAL_TOOL_NAMES.includes(name)) return this.reject("FORBIDDEN_TOOL", `Tool is not allowed: ${name || "(missing)"}`);

    let args;
    if (name === "search_decisions") {
      args = decisionArguments(rawArgs);
      if (args.isError) return this.reject(args.code, args.message);
    } else if (name === "search_law") {
      const query = text(rawArgs?.query);
      if (!query) return this.reject("EMPTY_QUERY_REJECTED", "search_law query must not be empty.");
      args = { query, display: integerOr(rawArgs?.display, config.lawSearchDisplay, 1, config.lawSearchDisplay) };
    } else if (name === "get_decision_text") {
      const domain = text(rawArgs?.domain);
      const id = text(rawArgs?.id);
      if (!DECISION_DOMAINS.has(domain) || !id) return this.reject("INVALID_ARGUMENT", "get_decision_text requires domain and id.");
      if (!this.ledger.isDecisionIdObserved(domain, id)) return this.reject("UNOBSERVED_DETAIL_REJECTED", "Decision detail id was not observed from a search result.");
      args = { domain, id, full: false };
    } else {
      const mst = text(rawArgs?.mst);
      const lawId = text(rawArgs?.lawId);
      if (!mst && !lawId) return this.reject("INVALID_ARGUMENT", "get_law_text requires mst or lawId.");
      if (!this.ledger.isLawObserved({ mst, lawId })) return this.reject("UNOBSERVED_DETAIL_REJECTED", "Law identifier was not observed from a law search result.");
      args = { ...(mst ? { mst } : {}), ...(lawId ? { lawId } : {}) };
      const jo = text(rawArgs?.jo);
      if (jo) args.jo = jo;
    }

    this.safety.assertCanContinue();
    this.safety.recordLegalToolCall();
    this.telemetry.recordToolCall(name);
    this.trace.push({ accepted: true, name, args: { ...args } });
    const raw = await this.callTool(name, args);
    const normalized = await this.normalizeResult(name, raw, args);

    if (name === "search_decisions" && !normalized.isError) {
      this.ledger.recordDecisionSearch({ query: args.query, domain: args.domain, items: normalized.items });
    } else if (name === "search_law" && !normalized.isError) {
      this.ledger.recordLawSearch({ query: args.query, items: normalized.items });
    } else if (name === "get_decision_text") {
      this.ledger.recordDecisionDetail({
        domain: args.domain,
        id: args.id,
        caseNumber: normalized.caseNumber,
        detail: normalized,
        rawText: normalized.rawText,
        verified: !normalized.isError,
      });
    } else if (name === "get_law_text") {
      this.ledger.recordLawText({ mst: args.mst, lawId: args.lawId, textOpened: !normalized.isError && Boolean(normalized.rawText) });
    }
    return normalized;
  }

  snapshotTrace() {
    return this.trace.map((item) => ({ ...item, args: item.args ? { ...item.args } : undefined }));
  }

  searchDecisions(args, context) {
    return this.execute("search_decisions", args, context);
  }

  searchLaw(args, context) {
    return this.execute("search_law", args, context);
  }

  getDecisionText(args, context) {
    return this.execute("get_decision_text", args, context);
  }

  getLawText(args, context) {
    return this.execute("get_law_text", args, context);
  }
}

export function createLegalToolGateway(options) {
  return new LegalToolGateway(options);
}
