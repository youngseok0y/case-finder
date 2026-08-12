import { config } from "../config.js";
import * as geminiRuntime from "./geminiRuntime.js";
import * as codexRuntime from "./codexCliRuntime.js";

const runtime = config.modelRuntime === "codex_cli" ? codexRuntime : geminiRuntime;

export const runtimeName = runtime.runtimeName;
export const modelName = config.modelRuntime === "codex_cli" ? config.codexModel : config.geminiModel;
export const reasoningEffort = config.modelRuntime === "codex_cli" ? config.codexReasoningEffort : null;

export function generatePlan(...args) {
  return runtime.generatePlan(...args);
}

export function selectCandidates(...args) {
  return runtime.selectCandidates(...args);
}

export function generateAgenticTurn(...args) {
  return runtime.generateAgenticTurn(...args);
}

export function parseSelectionResponse(...args) {
  return runtime.parseSelectionResponse(...args);
}
