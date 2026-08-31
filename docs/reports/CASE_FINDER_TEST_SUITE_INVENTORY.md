# Case Finder Test Suite Inventory

## Baseline

- Branch: `refactor/final-test-suite`
- Baseline source: `main`
- Baseline SHA: `7b4af805ddc16cd8ee25fa0494175d0088c9d9cf`
- Test files: 26
- `test()` cases: 132
- Baseline `npm run verify`: PASS (`check` 78 JavaScript/module files; tests 132/132; failures 0; test duration 7.1s)
- Baseline Node built-in coverage command: `node --test --experimental-test-coverage '--test-coverage-include=src/**/*.js' test/*.test.js`
- Baseline coverage: line 100.00%, branch 100.00%, function 100.00%

The coverage command reports loaded source modules in the current include scope. It is used as a repeatable comparison signal; semantic invariant ownership is reviewed separately before any deletion.

## Classification rules

- **CORE**: failure can violate a permanent packaged-product contract and runs during ordinary verification.
- **REGRESSION**: protects a specific historical bug, compatibility boundary, UI/API contract, or integration and runs in release verification.
- **EXPERIMENTAL**: protects evaluation-only instrumentation or a disabled experimental path and does not block packaging.
- **DUPLICATE_CANDIDATE**: no unique invariant after its assertions are preserved by an owning file.

## File inventory

| File | Tests | Primary feature | Production modules imported | Layer | Unique invariant / assertion focus | Overlap | Classification |
|---|---:|---|---|---|---|---|---|
| `adapters.test.js` | 3 | product contract / adapters | `adminConfig`, `config`, `searchAdapters`, `validator` | unit | adapter registry, fixed search limits, provider/model pins, verified-only natural result contract | `productFlow`, `validatorEvidenceUx` | CORE |
| `aoIntegrity.test.js` | 11 | Luna AO integrity | `codexNativeAo`, `evidenceLedger`, `legalToolGateway`, `lunaNativeAdapter`, `resultContract` | orchestration | search completion states, NOT_FOUND vs provider failure, delegated-tool fail-closed, forbidden tool, verified NO_RESULT boundary | `coreTrust`, `geminiCandidateAggregation`, `geminiSupportFinalization` | CORE |
| `appServerRuntime.test.js` | 11 | Codex App Server / account | `codexAppServerRuntime`, `codexAppServerSession`, `legalToolDefinitions`, `codexUsage`, `codexAccount` | runtime/API | initialize/thread/turn contract, four dynamic tools, account and quota normalization, auth-required states | `codexApi`, `codexModelSelection`, `authWeeklyQuotaFallbackUx` | CORE |
| `authWeeklyQuotaFallbackUx.test.js` | 6 | quota/fallback UI integration | `evidenceLedger`, `codexNativeAo`, `codexAppServerRuntime`, `progress`, `resultContract` | integration/UI | actual Luna-to-Terra fallback metadata/event, free-plan no-toast, Pro fallback toast, shared quota fields and copy | `appServerRuntime`, `codexApi`, `userFacingSearchCopy` | REGRESSION |
| `codexApi.test.js` | 2 | HTTP account/health API | `server` | HTTP integration | safe account/usage fields and public health redaction | `appServerRuntime`, `authWeeklyQuotaFallbackUx` | REGRESSION |
| `codexAuthIsolation.test.js` | 5 | Codex authentication isolation | `codexEnv`, `codexAuthIsolation`, `codexAppServerRuntime`, `codexRuntimeResolver` | security integration | dedicated home, file credential store, global auth sentinel unchanged, fail-closed unsafe paths | `codexLogin`, `runtimeSecurity`, `appServerRuntime` | CORE |
| `codexLogin.test.js` | 1 | development login helper | filesystem/path helpers and `codex-login.bat` fixture | packaging/dev helper | helper uses local Node and checkout dependencies | `codexAuthIsolation` | REGRESSION |
| `codexModelSelection.test.js` | 4 | plan-aware model selection | `aoV2`, `codexAppServerRuntime`, `lunaNativeAdapter`, `codexModelSelection` | unit/integration | Free/Go Terra selection, telemetry/execution metadata, actual fallback semantics, runtime/session policy boundary | `appServerRuntime`, `authWeeklyQuotaFallbackUx` | CORE |
| `commonEvidenceEnvelope.test.js` | 7 | common evidence envelope | `evidenceLedger`, `router`, `aoV2`, `lunaNativeAdapter` | unit/integration | observed/verified/selectable state, provider ID/domain provenance, compound identity, unknown case identity | `coreTrust`, `evidenceLedgerClaims`, `validatorEvidenceUx` | CORE |
| `coreTrust.test.js` | 7 | evidence trust / legal gateway | `evidenceLedger`, `finalSelectionGate`, `legalToolGateway`, `router` | unit | final eligibility, provider-bound identity, four-tool surface, search trace semantics | `aoIntegrity`, `commonEvidenceEnvelope`, `evidenceLedgerClaims` | CORE |
| `evidenceLedgerClaims.test.js` | 2 | claim ledger | `evidenceLedger`, `finalSelectionGate` | unit | runtime-only verified evidence and law-claim scoping | `coreTrust`, `commonEvidenceEnvelope`, `lawReferences` | CORE |
| `geminiCandidateAggregation.test.js` | 6 | Gemini retrieval/ranking | `nlPipeline` | unit/integration | anchor rank, support corroboration cap, Constitutional Court authority, candidateMax, declared domains, provider error distinction | `geminiPlanValidation`, `aoIntegrity`, `geminiDiagnosticTrace` | CORE |
| `geminiDiagnosticTrace.test.js` | 3 | Gemini diagnostic trace | `nlPipeline`, `resultContract` | experimental integration | M6E trace opt-in, raw candidates/query trace, trace write failure isolation | `geminiCandidateAggregation`, `geminiRefinedPlan` | EXPERIMENTAL |
| `geminiPlanValidation.test.js` | 2 | Gemini planner | `gemini` | unit | atomic query schema, anchor/support count and query limits | `geminiCandidateAggregation`, `geminiRefinedPlan` | CORE |
| `geminiRefinedPlan.test.js` | 4 | constitutional refined-search experiment | `gemini`, `nlPipeline` | experimental integration | refinement input restriction, constitutional anchor validation, candidate merge, non-fatal refinement failure | `geminiPlanValidation`, `geminiDiagnosticTrace` | EXPERIMENTAL |
| `geminiSelection.test.js` | 6 | Gemini selector schema | `gemini` | unit | direct/related_only/none normalization, direct downgrade, resultMax cap | `geminiSupportFinalization` | CORE |
| `geminiSupportFinalization.test.js` | 10 | Gemini finalization | `lunaNativeAdapter`, `resultContract`, `nlPipeline`, `validator` | integration | support-aware finalization, verified-only output, safe NO_RESULT, detail failure downgrade, private support field | `geminiSelection`, `aoIntegrity`, `validatorEvidenceUx` | CORE |
| `lawReferences.test.js` | 9 | law references/enrichment/UI link | `directLookup`, `renderer` | unit/integration | statute context, article links, observed lawId, provider-verified references, error drop, cross-law isolation | `legalMcpParser`, `parserPipelineRegression`, `evidenceLedgerClaims` | REGRESSION |
| `legalMcpParser.test.js` | 2 | legal MCP parser | `legalMcpParser` | unit | Korean precedent section parsing and HTML line-break decoding | `parserPipelineRegression`, `lawReferences` | REGRESSION |
| `parserPipelineRegression.test.js` | 3 | parser pipeline integration | parser/direct lookup/renderer via mocked modules | integration | parsed holding reaches candidate preview, statute references reach enrichment, verified-only Luna law enrichment | `legalMcpParser`, `lawReferences`, `validatorEvidenceUx` | REGRESSION |
| `productFlow.test.js` | 3 | product routing and adapter flow | `directLookup`, `renderer`, `searchAdapters`, `validator`, `router` | integration | deterministic direct routing, adapter contract parity, provider-backed empty/failure contract | `adapters`, `router`, `validatorEvidenceUx` | CORE |
| `router.test.js` | 4 | query routing | `router` | unit | modern/historical/spaced/hyphenated case identifiers, natural dates/statutes/quantities, conservative unknown codes, related/exclusion intents | `productFlow`, `commonEvidenceEnvelope` | CORE |
| `runtimeHygiene.test.js` | 6 | runtime hygiene/security | `codexAppServerRuntime`, `aoV2`, `mcpClient`, `log`, `server` | security integration | bounded diagnostic buffers, abort propagation, disconnect abort, redaction, packaging target guard | `runtimeSecurity`, `codexAuthIsolation` | CORE |
| `runtimeSecurity.test.js` | 5 | HTTP/MCP security | `mcpClient`, `server`, `runtimeEnv` | security unit/integration | localhost Host/Origin trust, timeout/retry, packaged Node, child-env secret filtering and CODEX_HOME isolation | `runtimeHygiene`, `codexAuthIsolation` | CORE |
| `userFacingSearchCopy.test.js` | 2 | UI/search status copy | `productMessages`, `renderer` | UI unit | related-only and search/detail failure wording | `authWeeklyQuotaFallbackUx`, `validatorEvidenceUx` | REGRESSION |
| `validatorEvidenceUx.test.js` | 8 | validator + renderer evidence UX | `codexNativeAo`, `legalToolGateway`, `evidenceLedger`, `finalSelectionGate`, `directLookup`, `renderer`, `validator` | integration/UI | verified/unverified intro sanitization, compound identity, law reference rendering, runtime failure preservation | `commonEvidenceEnvelope`, `geminiSupportFinalization`, `lawReferences`, `productFlow` | REGRESSION |

## Initial ownership proposal

The consolidation will use these owners before any deletion:

- `test/core/productContract.test.js`: adapter registry, fixed limits, provider/model pins, result contract.
- `test/core/routing.test.js`: all router behavior.
- `test/core/evidenceTrust.test.js`: EvidenceLedger and FinalSelectionGate invariants, provenance, compound identity, claim scoping.
- `test/core/lunaIntegrity.test.js`: AO orchestration, legal tool boundary, search completion and verified-only output.
- `test/core/codexRuntime.test.js`: App Server/session, usage/quota, plan model selection and actual fallback semantics.
- `test/core/codexAuth.test.js`: dedicated Codex authentication isolation and helper-specific security contract.
- `test/core/geminiRetrieval.test.js`: planner validation, declared-domain retrieval, candidate ranking, candidateMax and error semantics.
- `test/core/geminiFinalization.test.js`: selector/finalizer support contract and representative integration.
- `test/core/legalEvidence.test.js`: parser, law-reference enrichment and representative parser pipeline.
- `test/core/runtimeSecurity.test.js`: HTTP/MCP boundaries, abort, timeout, redaction and runtime hygiene.
- `test/regression/apiUiContract.test.js`: safe API fields and user-visible quota/fallback/search states.
- `test/regression/parserRegression.test.js`: representative validator/renderer evidence UX and parser-pipeline integration.
- `test/regression/packagingContract.test.js`: login helper and packaging prune behavior.
- `test/experimental/geminiDiagnosticTrace.test.js`: M6E trace tests only.
- `test/experimental/geminiRefinedPlan.test.js`: force-gated constitutional refinement tests only.

This proposal is a map, not a deletion quota. A test is deleted only after its unique invariant is represented by an owner and the baseline-vs-without-candidate comparison is recorded.
