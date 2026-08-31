import { text } from "./text.js";

function modelField(payload, keys) {
  const sources = [
    payload?.modelResolution,
    payload?.model_resolution,
    payload?.thread,
    payload?.turn,
    payload,
  ];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      const value = text(source[key]);
      if (value) return value;
    }
  }
  return "";
}

export function normalizeModelResolution(payload, requestedModel = "") {
  const requested = modelField(payload, ["requestedModel", "requested_model", "modelRequested", "model_requested"]) || text(requestedModel);
  const effective = modelField(payload, ["effectiveModel", "effective_model", "resolvedModel", "resolved_model", "modelName", "model_name", "model"]) || requested;
  const explicitSignal = Boolean(
    modelField(payload, ["effectiveModel", "effective_model", "resolvedModel", "resolved_model", "modelName", "model_name", "model"])
    || modelField(payload, ["requestedModel", "requested_model", "modelRequested", "model_requested"])
    || modelField(payload, ["fallbackReason", "fallback_reason"])
  );
  const normalizedRequested = requested.toLowerCase();
  const normalizedEffective = effective.toLowerCase();
  return {
    requestedModel: requested,
    effectiveModel: effective,
    fallbackApplied: Boolean(normalizedRequested && normalizedEffective && normalizedRequested !== normalizedEffective),
    hasSignal: explicitSignal,
  };
}

export function isLunaTerraFallback(value) {
  const requested = text(value?.requestedModel).toLowerCase();
  const effective = text(value?.effectiveModel).toLowerCase();
  return value?.fallbackApplied === true
    && requested.endsWith("-luna")
    && effective.endsWith("-terra");
}
