# Case Finder Fable Findings Closure

Phase 8 closure audit for branch `fix/final-prepackage-hardening` at commit
`79bfd92`. The review handoff states 10 top findings plus 31 additional
verified findings. The numbered groups contain 40 headings; the separate
HTML decoding rule is the 41st closure item and is recorded as `I5` below.

## Summary

| classification | count |
| --- | ---: |
| FIXED | 24 |
| REMOVED | 8 |
| CONSOLIDATED | 9 |
| REFUTED | 0 |
| OPEN | 0 |
| total | 41 |

All findings have an explicit closure. The final pre-packaging acceptance gate
is reported separately because managed runtime, live provider, and complete
staging verification depend on external/runtime artifacts not present in this
source checkout.

## Closure matrix

| ID | source file/location | review description | classification | disposition | changed files | regression test | status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | `src/codexUsage.js`; App Server session finalization | A failed usage write poisoned later writes and could invalidate a successful turn | correctness | FIXED | `src/codexUsage.js`, `src/aoV2/providers/codexNativeAo.js`, `src/aoV2/index.js` | `usage persistence failure does not poison the queue or invalidate a completed answer` | PASS | Write chain recovers; successful model result is not coupled to telemetry persistence. |
| A2 | `src/codexAppServerSession.js` | `turn/completed` could arrive before `turnId` assignment and be lost | concurrency | FIXED | `src/codexAppServerSession.js` | `buffers turn completion until turn/start assigns the turn id` | PASS | Pending completion is retained and consumed after assignment. |
| A3 | `src/codexAppServerSession.js` | Duplicate completion could produce duplicate finalization and usage writes | idempotency | FIXED | `src/codexAppServerSession.js` | `duplicate turn completion is idempotent before usage persistence resolves` | PASS | Completion guard is set before the first await. |
| A4 | `src/codexAppServerSession.js` / response boundary | A closed child stdin could turn an error response into an unhandled rejection | fault handling | FIXED | `src/codexAppServerSession.js`, `src/codexAppServerClient.js` | `closed app-server stdin does not create an unhandled rejection while responding to a failed request` | PASS | Secondary response failure is contained. |
| A5 | `src/codexAppServerRuntime.js` | Concurrent startup could expose a client before initialization and auth-isolation checks | lifecycle/auth isolation | FIXED | `src/codexAppServerRuntime.js` | `concurrent runtime starts share the initialization and auth-isolation gate` | PASS | One startup promise gates all callers. |
| A6 | `src/aoV2/index.js` / AO creation | Missing gateway default evaluation could throw an incidental `TypeError` | deterministic error | FIXED | `src/aoV2/providers/codexNativeAo.js` | `missing AO gateway reports the deterministic required-gateway error` | PASS | Missing gateway maps to the intended deterministic code. |
| B1 | `src/aoV2/evidenceLedger.js` | A failed later detail fetch could erase already verified provider evidence | evidence integrity | FIXED | `src/aoV2/evidenceLedger.js`, `src/aoV2/commonEvidenceEnvelope.js` | `verified evidence remains monotonic after a failed detail re-fetch` | PASS | Failure trace is retained while verified state and selectability remain. |
| B2 | router and evidence identity paths | Lexical case identity parsing was materially duplicated across routing and evidence | identity | CONSOLIDATED | `src/caseIdentity.js`, `src/router.js`, `src/aoV2/commonEvidenceEnvelope.js`, `src/aoV2/evidenceLedger.js` | `canonical case identity stays independent from the router allowlist`; routing suite | PASS | Canonical lexical identity is separate from direct-route allowlist policy. |
| C1 | `src/gemini.js`, `src/nlPipeline.js`, MCP call path | Gemini abort signal was not propagated through later pipeline work | lifecycle/abort | FIXED | `src/gemini.js`, `src/geminiRuntime.js`, `src/nlPipeline.js`, `src/searchAdapters/geminiDAdapter.js` | `Gemini adapter abort stops the pipeline before later MCP work` | PASS | No later Gemini or MCP phase runs after abort. |
| C2 | `src/gemini.js` prompt interpolation | User/provider text containing replacement tokens could corrupt prompts | correctness | FIXED | `src/gemini.js` | `prompt values containing replacement tokens are inserted byte-for-byte` | PASS | Functional replacement semantics preserve `$&`, `$'`, `$\``, and `$$`. |
| C3 | `src/gemini.js`, `src/nlPipeline.js` | Selector abstention, exception, and legacy malformed output were inferred from `support` shape | contract | FIXED | `src/gemini.js`, `src/nlPipeline.js`, `test/core/geminiFinalization.test.js` | `selector abstention and selector failure have explicit internal outcomes` | PASS | Public response shape remains unchanged. |
| D1 | `start.bat`, `codex-login.bat` | Global delayed expansion could corrupt profile paths containing `!` | Windows path safety | FIXED | `start.bat`, `codex-login.bat` | `Windows launcher avoids delayed path expansion and stale PID block values` | PASS | Path expansion is kept safe; test inspects launcher blocks. |
| D2 | `start.bat` `:stopServer` | Parse-time `%PORT_PID%` expansion could report/use a stale PID | Windows lifecycle | FIXED | `start.bat` | `Windows launcher avoids delayed path expansion and stale PID block values` | PASS | Stop path uses deterministic runtime PID handling. |
| D3 | `src/verifyManagedRuntime.js` | Invalid JSON from a 200 health response escaped the retry catch | managed health | FIXED | `src/verifyManagedRuntime.js` | `managed health retries a 200 response with invalid JSON` | PASS | JSON parsing is awaited inside the retry boundary. |
| D4 | `packaging/prune-staging.mjs` | Packaging prune declaration contained an empty/no-op level | packaging safety | FIXED | `packaging/prune-staging.mjs` | `packaging prune has only non-empty levels and fails closed for missing targets` | PASS | Missing stage/targets fail closed and targets stay under `node_modules`. |
| D5 | packaging manifest and resource contract | Manifest could drift from live runtime resource reads after experimental removal | packaging contract | FIXED | `test/regression/packagingContract.test.js`, current `packaging/runtime-manifest.json` | `runtime manifest includes every live prompt and public resource read` | PASS | Dead `refine-plan.txt` is absent; full staging remains separately blocked by missing managed Node. |
| E1 | refined-search production path | Constitutional refined-search experiment was not production behavior | dead experimental code | REMOVED | `src/nlPipeline.js`, `src/gemini.js`, `src/geminiRuntime.js`, `prompts/refine-plan.txt`, related tests | repository-wide dead-reference audit; `test:all` | PASS | No production/test/script reference remains; historical Git objects are not scanned. |
| E2 | diagnostic trace path | M6E diagnostic trace machinery was evaluation-only production code | dead experimental code | REMOVED | Gemini pipeline/telemetry cleanup in `29d42c9`; related tests | repository-wide dead-reference audit; `test:all` | PASS | No `M6E_D_TRACE` or `M6E_D_TRACE_PATH` production reference remains. |
| E3 | Gemini request helpers | Obsolete injection options and duplicated request paths survived refined-path deletion | dead API surface | REMOVED | `src/gemini.js`, `src/geminiRuntime.js`, `src/rateLimiter.js` | Gemini finalization/retrieval tests; `npm run verify` | PASS | Zero-caller obsolete options were removed while model/retry/quota semantics remain pinned. |
| E4 | `src/rateLimiter.js`, Gemini fallback paths | Dead daily/question limit branches and obsolete wording were retained | dead branches | REMOVED | `src/rateLimiter.js`, `src/productMessages.js`, `src/gemini.js` | user-facing contract tests; repository-wide caller search | PASS | RPM waiting and daily RPD behavior remain; no zero-caller branch remains. |
| E5 | product status constants | `SEARCH_STATUS_LABELS` was not a runtime consumer contract | dead constant | REMOVED | `src/productMessages.js`, related UI/tests | progress/UI contract tests; repository-wide caller search | PASS | Tests assert rendered behavior rather than importing a dead constant. |
| E6 | `src/aoV2/index.js` and exported helpers | Zero-caller exports/options were retained as compatibility surface | dead API surface | REMOVED | `src/aoV2/index.js`, `src/nlPipeline.js` | repository-wide import search; `npm run test:all` | PASS | Standalone `runAgenticSearchV2` export was removed; factory execution uses `runWithContext`. |
| E7 | `src/aoV2/index.js` | Persistent `lastRun` retained prior evidence context and extended object lifetime | memory lifetime | REMOVED | `src/aoV2/index.js` | `runWithContext` lifecycle tests; repository-wide dead-reference audit | PASS | Invocation context is returned directly; no retained previous run is exposed. |
| E8 | `package.json`, `test/experimental/` | Experimental tier became an empty/obsolete test surface | test structure | REMOVED | `package.json`, `test/experimental/geminiDiagnosticTrace.test.js`, `test/experimental/geminiRefinedPlan.test.js` | `test:all` equals core plus regression and passes 150/150 | PASS | No `test:experimental` script remains. |
| F1 | `src/directLookup.js`, Luna/Gemini result paths | Decision links were duplicated and omitted consistent `admin_appeal` handling | implementation duplication | CONSOLIDATED | `src/directLookup.js`, `src/searchAdapters/lunaNativeAdapter.js`, `src/renderer.js` | `Luna verified administrative-appeal items use the safe user-facing detail link` | PASS | `decisionDetailLink` is the canonical link generator for all three domains. |
| F2 | law enrichment, aggregation, renderer | Law-reference identity and dedupe semantics differed by module | implementation duplication | CONSOLIDATED | `src/lawReferences.js`, `src/directLookup.js`, `src/nlPipeline.js`, `src/renderer.js`, `src/searchAdapters/lunaNativeAdapter.js` | `canonical law references normalize identity and retain only renderable links`; enrichment tests | PASS | Verified-only and missing-link behavior are preserved. |
| F3 | repeated text normalization helpers | Semantically identical string trimming was repeated | small helper duplication | CONSOLIDATED | `src/text.js` and callers | full core/regression suite; static helper search | PASS | One small `text()` helper was added without a generic utility framework. |
| F4 | MCP probe code | MCP probe reimplemented tool-text extraction inline | helper duplication | CONSOLIDATED | `src/mcpClient.js`, `src/legalMcpParser.js` | result-classification and MCP contract tests | PASS | Probe and consumers use canonical `toolText()`. |
| F5 | `src/nlPipeline.js` Gemini pipeline | Candidate/result aliases and obsolete telemetry fields obscured one pipeline contract | implementation duplication | CONSOLIDATED | `src/nlPipeline.js`, `src/gemini.js`, Gemini tests | parsed precedent preview and full regression suite | PASS | Live ranking/finalization semantics remain unchanged; obsolete aliases are absent. |
| G1 | legal MCP consumers | Sentinel/error classification was independently matched in several modules | taxonomy | CONSOLIDATED | `src/legalResultClassifier.js`, `src/aoV2/legalToolGateway.js`, `src/directLookup.js`, `src/nlPipeline.js`, `src/mcpClient.js` | `legal result categories distinguish success, sentinels, provider errors, and invalid payloads` | PASS | NOT_FOUND, hallucination, provider error, and invalid payload semantics are shared. |
| G2 | `src/httpApi.js` Codex errors | HTTP layer used a hardcoded mega allowlist of current runtime codes | taxonomy | CONSOLIDATED | `src/codexError.js`, `src/httpApi.js` | `future Codex app-server errors use the unavailable runtime response` | PASS | Prefix/category classification covers future App Server codes without exposing details. |
| G3 | adapter registry/config/admin/health | Adapter IDs, labels, stages, and supported values were duplicated | metadata source | CONSOLIDATED | `src/searchAdapters/catalog.js`, `src/searchAdapters/registry.js`, `src/adminConfig.js`, `config.js`, public consumers | `product adapter registry and search configuration are frozen` | PASS | Catalog contains exactly `gemini_d` and `luna_native`. |
| G4 | renderer and public status copy | Search failure wording differed between server-rendered and client status paths | user-facing contract | FIXED | `src/renderer.js`, `public/app.js`, `src/productMessages.js` | `search failure copy covers both search and detail verification` | PASS | Copy covers search and/or original-text verification failure consistently. |
| H1 | `src/codexAccount.js` | Repeated account/rate-limit reads caused redundant App Server IPC | efficiency/lifecycle | FIXED | `src/codexAccount.js` | `account and rate-limit reads use a bounded cache until notification or expiry` | PASS | Cache is bounded, invalidated by notifications, and not indefinite. |
| H2 | `src/directLookup.js`, `src/nlPipeline.js` | Duplicate law references caused repeated search/detail calls | efficiency | FIXED | `src/directLookup.js`, `src/nlPipeline.js`, `src/searchAdapters/lunaNativeAdapter.js` | `enrichLawReferences shares duplicate work and caps provider concurrency at two` | PASS | Per-query memoization and bounded concurrency cap redundant calls. |
| H3 | `src/httpApi.js`, `src/codexAppServerRuntime.js` | Independent health work serialized and runtime resolution repeated | efficiency/lifecycle | FIXED | `src/httpApi.js`, `src/codexAppServerRuntime.js` | `runtime inspection metadata is resolved once and shared by concurrent health checks` | PASS | Immutable runtime metadata is cached; login/quota/MCP state is not cached as immutable. |
| I1 | `src/httpApi.js` body reader | Chunked oversized requests could destroy the stream before returning a response | HTTP correctness | FIXED | `src/httpApi.js` | `chunked oversized request returns a JSON 413 after draining the body` | PASS | Body is drained and bounded 413 JSON is returned. |
| I2 | `src/codexAccount.js` reset formatting | ISO `resetsAt` values were not accepted consistently | account UX | FIXED | `src/codexAccount.js` | Codex quota/reset normalization including ISO `resetsAt` fixture | PASS | Epoch seconds, milliseconds, and ISO values render valid KST labels. |
| I3 | `src/server.js` signal handlers | Duplicate signal handlers lacked one idempotent bounded shutdown path | lifecycle | FIXED | `src/server.js` | `graceful shutdown is idempotent and bounds an active request` | PASS | HTTP close, account/runtime/MCP close, and deadline are one guarded path. |
| I4 | `src/renderer.js` obsolete maximum branch | Unreachable hard-coded “최대 5개” remained independent of configuration | UI dead path | FIXED | `src/renderer.js`, `src/router.js` | renderer/product contract tests; static search | PASS | Unreachable branch and unused count were removed. |
| I5 | `src/legalMcpParser.js` `decodeBasicHtml` | One decoder call could decode two HTML entity layers | parser correctness | FIXED | `src/legalMcpParser.js`, `test/core/legalEvidence.test.js` | `parseDecisionDetail decodes HTML line breaks before section parsing`; parser corpus tests | PASS | One call performs one layer; double-encoded entities remain single-decoded. |

## Static audit evidence

- No unintended production/test references were found for `M6E_D_TRACE`,
  `M6E_D_TRACE_PATH`, `M6E_STAGE6_FORCE_REFINED`, `forceRefinedPass`,
  `generateRefinedPlan`, `REFINED_PLAN_SCHEMA`, `refine-plan.txt`, or
  `lastRun`. The packaging regression contains only a negative assertion that
  the removed `refine-plan.txt` is absent from the manifest.
- Canonical definitions are present for decision links, legal result
  classification, Codex error classification, adapter catalog, law-reference
  dedupe, `toolText`, and low-level case identity. Routing eligibility remains
  a separate policy in `router.js`.
- The repository contains only the two product adapter IDs:
  `gemini_d` and `luna_native`.

## Performance acceptance evidence

These are deterministic fixture counts, not a provider benchmark.

| path | representative before/after interpretation | observed evidence |
| --- | --- | --- |
| Codex account IPC | repeated reads would issue one IPC per read; cached repeated reads issue one `account/read` and one `account/rateLimits/read` until expiry | cache test asserts 1/1 before expiry and 2/2 after expiry-triggered refresh |
| Law MCP duplicate references | overlapping requests without memoization would repeat the shared reference; memoized fixture performs one search/detail pair per unique law/article | two overlapping calls assert 3 `search_law` and 3 `get_law_text` calls, with the shared `민법` search occurring once |
| Health runtime resolution | repeated inspections would resolve each time; cached concurrent/sequential inspections resolve once | runtime test asserts `resolveCalls === 1` across concurrent and subsequent inspections |

No arbitrary latency target or provider load test was used.
