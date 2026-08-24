function modelText(value) {
  return typeof value === "string" ? value.trim() : "";
}

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
      const value = modelText(source[key]);
      if (value) return value;
    }
  }
  return "";
}

function modelFlag(payload) {
  const sources = [
    payload?.modelResolution,
    payload?.model_resolution,
    payload?.thread,
    payload?.turn,
    payload,
  ];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["fallbackApplied", "fallback_applied"]) {
      if (source[key] !== undefined) return source[key] === true;
    }
  }
  return false;
}

export function normalizeModelResolution(payload, requestedModel = "") {
  const requested = modelField(payload, ["requestedModel", "requested_model", "modelRequested", "model_requested"]) || modelText(requestedModel);
  const effective = modelField(payload, ["effectiveModel", "effective_model", "resolvedModel", "resolved_model", "modelName", "model_name", "model"]) || requested;
  const explicitSignal = Boolean(
    modelField(payload, ["effectiveModel", "effective_model", "resolvedModel", "resolved_model", "modelName", "model_name", "model"])
    || modelField(payload, ["requestedModel", "requested_model", "modelRequested", "model_requested"])
    || modelField(payload, ["fallbackReason", "fallback_reason"])
  );
  const normalizedRequested = requested.toLowerCase();
  const normalizedEffective = effective.toLowerCase();
  const modelFallback = normalizedRequested.endsWith("-luna")
    && normalizedEffective.endsWith("-terra");
  return {
    requestedModel: requested,
    effectiveModel: effective,
    fallbackApplied: modelFlag(payload) || modelFallback,
    hasSignal: explicitSignal,
  };
}

export function isLunaTerraFallback(value) {
  const requested = modelText(value?.requestedModel).toLowerCase();
  const effective = modelText(value?.effectiveModel).toLowerCase();
  return value?.fallbackApplied === true
    && requested.endsWith("-luna")
    && effective.endsWith("-terra");
}
