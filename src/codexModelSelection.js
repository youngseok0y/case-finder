const TERRA_PLANS = new Set(["free", "go"]);

const TERRA_MODEL = "gpt-5.6-terra";
const LUNA_MODEL = "gpt-5.6-luna";

function normalizedPlanType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function selectCodexModel(planType) {
  return TERRA_PLANS.has(normalizedPlanType(planType)) ? TERRA_MODEL : LUNA_MODEL;
}
