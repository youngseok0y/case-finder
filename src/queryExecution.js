import { config } from "../config.js";
import { lookupDirect } from "./directLookup.js";
import { renderResults } from "./renderer.js";
import { routeQuery } from "./router.js";
import { createProgressReporter } from "./progress.js";
import { getSearchAdapterDefinition } from "./searchAdapters/catalog.js";
import { defaultSearchAdapterRegistry } from "./searchAdapters/registry.js";
import { assertResultContract } from "./searchAdapters/resultContract.js";
import { validateDirectResult, validateNaturalResult } from "./validator.js";
import { PRODUCT_SERVICE } from "./productMessages.js";

function verifiedCount(result) {
  return (result?.items || []).filter((item) => item.status === "verified").length;
}

function lawCount(result) {
  return Array.isArray(result?.lawReferences) ? result.lawReferences.length : 0;
}

function candidateCount(result) {
  return Array.isArray(result?.candidateCaseNumbers) ? result.candidateCaseNumbers.length : 0;
}

function responseForResult({ query, route, result, stage }) {
  return {
    ok: true,
    service: PRODUCT_SERVICE,
    stage,
    route,
    query,
    html: renderResults(result),
    result,
  };
}

export async function executeQuery(query, onProgress = () => {}, { abortSignal = null } = {}) {
  const progress = createProgressReporter(onProgress);
  progress.emit("SEARCH_STARTED");
  const route = routeQuery(query, config.caseNumberMax);
  progress.emit("ROUTE_IDENTIFIED", { route: route.kind, ...route.telemetry });

  if (route.kind === "direct") {
    const lookedUp = await lookupDirect(query, route, { abortSignal });
    const validated = await validateDirectResult(lookedUp);
    progress.emit("DETAIL_VERIFIED", {
      route: "direct",
      candidateCount: validated.items?.length || 0,
      verifiedCount: verifiedCount(validated),
      lawCount: lawCount(validated),
    });
    progress.emit("FINALIZING", { route: "direct", verifiedCount: verifiedCount(validated) });
    const response = responseForResult({ query, route: "direct", result: validated, stage: "DIRECT" });
    progress.emit("SEARCH_COMPLETE", { route: "direct", verifiedCount: verifiedCount(validated), lawCount: lawCount(validated) });
    return { status: 200, payload: response };
  }

  const adapter = defaultSearchAdapterRegistry.resolve(config.searchAdapter);
  const adapterResult = await adapter.runNaturalQuery(query, {
    onProgress: (event, details) => progress.emit(event, { ...details, route: "natural" }),
    abortSignal,
  });
  const validated = await validateNaturalResult(adapterResult);
  const publicResult = assertResultContract(validated);
  const adapterDefinition = getSearchAdapterDefinition(config.searchAdapter);
  const response = responseForResult({
    query,
    route: "natural",
    result: publicResult,
    stage: adapterDefinition?.stage || "",
  });
  progress.emit("SEARCH_COMPLETE", {
    route: "natural",
    candidateCount: candidateCount(publicResult),
    verifiedCount: verifiedCount(publicResult),
    lawCount: lawCount(publicResult),
  });
  return { status: 200, payload: response };
}
