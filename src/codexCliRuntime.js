import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { config, ROOT_DIR } from "../config.js";

export const runtimeName = "codex_cli";

const CODEX_CREDIT_RATES = Object.freeze({ input: 25, cached: 2.5, output: 150 });
const HANDOFF_API_RATES = Object.freeze({ input: 1, cached: 0.1, output: 6 });
const CURRENT_API_RATES = Object.freeze({ input: 0.2, cached: 0.02, output: 1.2 });
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    keywords: { type: "array", minItems: 8, maxItems: 12, items: { type: "string" } },
    law_names: { type: "array", maxItems: 5, items: { type: "string" } },
    domains: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", enum: ["precedent", "constitutional", "admin_appeal"] } },
  },
  required: ["keywords", "law_names", "domains"],
};
const AGENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["tool_call", "final"] },
    tool: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        name: { type: "string", enum: ["search_decisions", "search_law", "get_law_text", "get_decision_text"] },
        arguments: {
          type: "object",
          additionalProperties: false,
          properties: {
            domain: { type: "string", enum: ["precedent", "constitutional", "admin_appeal"] },
            query: { type: "string" },
            display: { type: "integer", minimum: 1, maximum: 20 },
            mst: { type: "string" },
            lawId: { type: "string" },
            jo: { type: "string" },
            id: { type: "string" },
          },
          required: ["domain", "query", "display", "mst", "lawId", "jo", "id"],
        },
      },
      required: ["name", "arguments"],
    },
    selected: { type: ["array", "null"], maxItems: 5, items: { type: "object", additionalProperties: false, properties: { case_no: { type: "string" }, match: { type: "string", enum: ["direct", "related"] } }, required: ["case_no", "match"] } },
    intro: { type: ["string", "null"] },
  },
  required: ["action", "tool", "selected", "intro"],
};

let planPrompt = null;
let selectPrompt = null;
let agentPrompt = null;

function fillPrompt(prompt, values) {
  return prompt
    .replace("{{USER_QUERY}}", values.query)
    .replace("{{CANDIDATES}}", values.candidates || "");
}

async function getPrompt(name) {
  const fileName = name === "plan" ? "plan.txt" : name === "select" ? "select.txt" : "agent.txt";
  const key = name === "plan" ? "planPrompt" : name === "select" ? "selectPrompt" : "agentPrompt";
  if (!({ planPrompt, selectPrompt, agentPrompt }[key])) {
    const prompt = await fs.readFile(path.join(ROOT_DIR, "prompts", fileName), "utf8");
    if (name === "plan") planPrompt = prompt;
    if (name === "select") selectPrompt = prompt;
    if (name === "agent") agentPrompt = prompt;
  }
  return name === "plan" ? planPrompt : name === "select" ? selectPrompt : agentPrompt;
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function calculateCodexCosts(usage) {
  const input = number(usage.input_tokens);
  const cached = number(usage.cached_input_tokens);
  const output = number(usage.output_tokens);
  const calculate = (rates) => (input / 1_000_000) * rates.input
    + (cached / 1_000_000) * rates.cached
    + (output / 1_000_000) * rates.output;
  return {
    codex_credit_equivalent: calculate(CODEX_CREDIT_RATES),
    api_equivalent_usd: calculate(CURRENT_API_RATES),
    api_equivalent_usd_handoff_snapshot: calculate(HANDOFF_API_RATES),
  };
}

function normalizeUsage(usage) {
  if (!usage) return null;
  const normalized = {
    input_tokens: number(usage.input_tokens),
    cached_input_tokens: number(usage.cached_input_tokens),
    output_tokens: number(usage.output_tokens),
    reasoning_tokens: usage.reasoning_tokens === null || usage.reasoning_tokens === undefined ? null : number(usage.reasoning_tokens),
  };
  if (normalized.input_tokens === 0 && normalized.output_tokens === 0) return null;
  return normalized;
}

function usageFromEvent(event) {
  const raw = event?.usage || event?.payload?.info?.last_token_usage || event?.payload?.info?.total_token_usage;
  if (!raw) return null;
  return normalizeUsage({
    input_tokens: raw.input_tokens,
    cached_input_tokens: raw.cached_input_tokens,
    output_tokens: raw.output_tokens,
    reasoning_tokens: raw.reasoning_output_tokens,
  });
}

function parseJsonLines(stdout) {
  const events = [];
  for (const line of String(stdout || "").split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch {
      throw new Error("CODEX_PROTOCOL_INVALID_NON_JSON_STDOUT");
    }
  }
  return events;
}

export function parseCodexJsonl(stdout) {
  const events = parseJsonLines(stdout);
  const messageEvent = [...events].reverse().find((event) => event.type === "item.completed" && event.item?.type === "agent_message");
  const message = messageEvent?.item?.text || [...events].reverse().find((event) => event.type === "event_msg" && event.payload?.type === "agent_message")?.payload?.message;
  const usage = [...events].reverse().map(usageFromEvent).find(Boolean);
  if (!message) throw new Error("M7_TOKEN_TELEMETRY_UNAVAILABLE:CODEX_FINAL_MESSAGE_MISSING");
  if (!usage) throw new Error("M7_TOKEN_TELEMETRY_UNAVAILABLE");
  let value;
  try {
    value = JSON.parse(String(message).trim());
  } catch (error) {
    throw new Error(`CODEX_PROTOCOL_INVALID_JSON:${error.message}`);
  }
  return { value, usage, events };
}

function appendTelemetry(telemetry, usage, elapsedMs) {
  if (!telemetry) return;
  const costs = calculateCodexCosts(usage);
  telemetry.codexRequests = (telemetry.codexRequests || 0) + 1;
  telemetry.codexInputTokens = (telemetry.codexInputTokens || 0) + usage.input_tokens;
  telemetry.codexCachedInputTokens = (telemetry.codexCachedInputTokens || 0) + usage.cached_input_tokens;
  telemetry.codexOutputTokens = (telemetry.codexOutputTokens || 0) + usage.output_tokens;
  telemetry.codexReasoningTokens = (telemetry.codexReasoningTokens || 0) + (usage.reasoning_tokens || 0);
  telemetry.codexCreditEquivalent = (telemetry.codexCreditEquivalent || 0) + costs.codex_credit_equivalent;
  telemetry.codexApiEquivalentUsd = (telemetry.codexApiEquivalentUsd || 0) + costs.api_equivalent_usd;
  telemetry.codexHandoffApiEquivalentUsd = (telemetry.codexHandoffApiEquivalentUsd || 0) + costs.api_equivalent_usd_handoff_snapshot;
  telemetry.codexElapsedMs = (telemetry.codexElapsedMs || 0) + elapsedMs;
  telemetry.runtime = runtimeName;
  telemetry.model = config.codexModel;
  telemetry.reasoningEffort = config.codexReasoningEffort;
}

async function schemaPath(name, schema) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(schema)).digest("hex").slice(0, 16);
  const directory = path.join(ROOT_DIR, "test", "private", "m7-codex-runtime", "schemas");
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${name}-${digest}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  return filePath;
}

function runCodex(prompt, schema) {
  return new Promise(async (resolve, reject) => {
    const startedAt = Date.now();
    const schemaFile = await schemaPath(schema.name, schema.value);
    const args = [
      "exec", "--json", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only",
      "--cd", config.codexWorkdir, "--model", config.codexModel,
      "-c", `model_reasoning_effort=\"${config.codexReasoningEffort}\"`,
      "--output-schema", schemaFile, "-",
    ];
    const child = spawn(config.codexCliPath, args, {
      cwd: config.codexWorkdir,
      env: { ...process.env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), config.codexTimeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = `${stderr}\n${stdout}`.replace(/\s+/gu, " ").trim().slice(-2000);
        reject(new Error(`CODEX_EXEC_FAILED:${code ?? "null"}:${signal || ""}:${detail}`));
        return;
      }
      try {
        const parsed = parseCodexJsonl(stdout);
        resolve({ ...parsed, elapsedMs: Date.now() - startedAt });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(prompt);
  });
}

async function invoke(prompt, schema, telemetry) {
  const result = await runCodex(prompt, schema);
  appendTelemetry(telemetry, result.usage, result.elapsedMs);
  return result;
}

function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.keywords) || plan.keywords.length < 1 || plan.keywords.length > 12) throw new Error("CODEX_PLAN_SCHEMA_INVALID");
  const keywords = [...new Set(plan.keywords.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
  const lawNames = [...new Set((Array.isArray(plan.law_names) ? plan.law_names : []).filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))].slice(0, 5);
  const domains = [...new Set((Array.isArray(plan.domains) ? plan.domains : []).filter((value) => ["precedent", "constitutional", "admin_appeal"].includes(value)))];
  if (keywords.length === 0 || domains.length === 0) throw new Error("CODEX_PLAN_SCHEMA_INVALID");
  return { keywords: keywords.slice(0, 12), law_names: lawNames, domains: domains.slice(0, 3) };
}

function validateSelection(selection) {
  if (!selection || !Array.isArray(selection.selected)) throw new Error("CODEX_SELECTION_SCHEMA_INVALID");
  return {
    selected: selection.selected.slice(0, 5).filter((item) => item && typeof item.case_no === "string" && ["direct", "related"].includes(item.match)),
    intro: typeof selection.intro === "string" ? selection.intro.trim() : "",
  };
}

function selectionSchema(caseNumbers) {
  return {
    name: `selection-${crypto.createHash("sha256").update(caseNumbers.join("\n")).digest("hex").slice(0, 12)}`,
    value: {
      type: "object",
      additionalProperties: false,
      properties: {
        selected: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, properties: { case_no: { type: "string", enum: caseNumbers }, match: { type: "string", enum: ["direct", "related"] } }, required: ["case_no", "match"] } },
        intro: { type: "string" },
      },
      required: ["selected", "intro"],
    },
  };
}

function toResponse(value, usage) {
  return {
    text: JSON.stringify(value),
    usageMetadata: {
      promptTokenCount: usage.input_tokens,
      candidatesTokenCount: usage.output_tokens,
    },
    functionCalls: [],
  };
}

export async function generatePlan(query, telemetry = null) {
  const prompt = `${await getPrompt("plan")}\n\nRuntime constraint: do not inspect files, call tools, use MCP, or modify anything.\n`;
  const result = await invoke(fillPrompt(prompt, { query }), { name: "plan", value: PLAN_SCHEMA }, telemetry);
  return validatePlan(result.value);
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
  const prompt = `${await getPrompt("select")}\n\nRuntime constraint: do not inspect files, call tools, use MCP, or modify anything.\n`;
  const result = await invoke(fillPrompt(prompt, { query, candidates: candidateText }), selectionSchema(candidates.map((candidate) => candidate.caseNumber)), telemetry);
  return validateSelection(result.value);
}

export function parseSelectionResponse(response) {
  if (!response?.text) throw new Error("CODEX_SELECTION_RESPONSE_MISSING");
  return validateSelection(JSON.parse(response.text));
}

export async function generateAgenticTurn(contents, observedCaseNumbers, questionCalls, options = {}) {
  const prompt = `${await getPrompt("agent")}\n\nRuntime constraint: do not inspect files, call tools, use MCP, or modify anything. The host application executes any requested tool after validating the JSON action.\n\n<observed_case_numbers>\n${JSON.stringify(observedCaseNumbers)}\n</observed_case_numbers>\n<conversation_state>\n${JSON.stringify(contents)}\n</conversation_state>\nReturn exactly one JSON action.\n`;
  const result = await invoke(prompt, { name: "agent", value: AGENT_SCHEMA }, options.telemetry);
  const value = result.value;
  if (value?.action === "tool_call") {
    if (!value.tool || typeof value.tool.name !== "string" || !value.tool.arguments || typeof value.tool.arguments !== "object") throw new Error("CODEX_AGENT_TOOL_ACTION_INVALID");
    const call = { name: value.tool.name, args: value.tool.arguments };
    const response = toResponse(value, result.usage);
    response.functionCalls = [call];
    response.candidates = [{ content: { role: "model", parts: [{ functionCall: call }] } }];
    return { response, callsUsed: 1 };
  }
  if (value?.action === "final") {
    const response = toResponse({ selected: value.selected || [], intro: value.intro || "" }, result.usage);
    response.functionCalls = [];
    return { response, callsUsed: 1 };
  }
  throw new Error("CODEX_AGENT_ACTION_INVALID");
}
