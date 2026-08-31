# Final Test Suite Consolidation

Decision: `TEST_SUITE_CONSOLIDATION_PASS`

## Baseline

- Baseline branch: `main`
- Baseline SHA: `7b4af805ddc16cd8ee25fa0494175d0088c9d9cf`
- Baseline test files: 26
- Baseline tests: 132
- Baseline `npm run verify`: PASS
  - syntax/check files: 78
  - tests: 132/132
  - failures: 0
  - test duration: 7.1s
- Baseline built-in coverage: line 100.00%, branch 100.00%, function 100.00%

The baseline was captured before any test movement or deletion. The full inventory is in [`CASE_FINDER_TEST_SUITE_INVENTORY.md`](CASE_FINDER_TEST_SUITE_INVENTORY.md).

## Functional test map

| Functional owner | Original files | Original tests | Final file | Final tests |
|---|---|---:|---|---:|
| Product contract / adapters | `adapters.test.js`, `productFlow.test.js` | 6 | `test/core/productContract.test.js` | 6 |
| Routing | `router.test.js` | 4 | `test/core/routing.test.js` | 4 |
| Evidence trust / claims | `commonEvidenceEnvelope.test.js`, `coreTrust.test.js`, `evidenceLedgerClaims.test.js` | 16 | `test/core/evidenceTrust.test.js` | 16 |
| Luna AO integrity | `aoIntegrity.test.js` | 11 | `test/core/lunaIntegrity.test.js` | 11 |
| Codex App Server / model policy | `appServerRuntime.test.js`, `codexModelSelection.test.js` | 15 | `test/core/codexRuntime.test.js` | 15 |
| Codex authentication isolation | `codexAuthIsolation.test.js` | 5 | `test/core/codexAuth.test.js` | 5 |
| Gemini retrieval / planning | `geminiPlanValidation.test.js`, `geminiCandidateAggregation.test.js` | 8 | `test/core/geminiRetrieval.test.js` | 8 |
| Gemini selection / finalization | `geminiSelection.test.js`, `geminiSupportFinalization.test.js` | 16 | `test/core/geminiFinalization.test.js` | 16 |
| Legal parser / law evidence | `legalMcpParser.test.js`, `lawReferences.test.js`, `parserPipelineRegression.test.js` | 14 | `test/core/legalEvidence.test.js` | 14 |
| Runtime security / hygiene | `runtimeHygiene.test.js`, `runtimeSecurity.test.js` | 11 | `test/core/runtimeSecurity.test.js` | 11 |
| API and user-facing contract | `codexApi.test.js`, `authWeeklyQuotaFallbackUx.test.js`, `userFacingSearchCopy.test.js` | 10 | `test/regression/apiUiContract.test.js` | 10 |
| Validator/parser evidence UX | `validatorEvidenceUx.test.js` | 8 | `test/regression/parserRegression.test.js` | 8 |
| Packaging/login helper | `codexLogin.test.js` | 1 | `test/regression/packagingContract.test.js` | 1 |
| Gemini diagnostic instrumentation | `geminiDiagnosticTrace.test.js` | 3 | `test/experimental/geminiDiagnosticTrace.test.js` | 3 |
| Gemini refined-search experiment | `geminiRefinedPlan.test.js` | 4 | `test/experimental/geminiRefinedPlan.test.js` | 4 |

Result: 26 original test files became 15 tier-owned files. All 132 test bodies and their assertions were retained; no test assertion was deleted.

## Classification

### CORE

10 files, 106 tests:

- product contract, routing, evidence trust, Luna integrity
- Codex runtime and auth isolation
- Gemini retrieval and finalization
- legal evidence
- runtime security and hygiene

### REGRESSION

3 files, 19 tests:

- API/quota/fallback/user-facing contract
- validator and parser-pipeline evidence UX
- development login helper and packaging contract

### EXPERIMENTAL

2 files, 7 tests:

- `M6E_D_TRACE_PATH` diagnostic instrumentation
- force-gated Gemini constitutional refined-search path

Experimental activation status was not changed. These tests are excluded from `npm run verify` and available through `npm run test:experimental` or `npm run test:all`.

## Coverage

Coverage used Node 24 built-in test coverage with `src/**/*.js` as the include scope.

| Suite | Files | Tests | Line | Branch | Function | Test duration |
|---|---:|---:|---:|---:|---:|---:|
| Before: old full suite | 26 | 132 | 100.00% | 100.00% | 100.00% | 10.9s |
| After: CORE | 10 | 106 | 100.00% | 100.00% | 100.00% | 4.1s |
| After: CORE + REGRESSION | 13 | 125 | 100.00% | 100.00% | 100.00% | 4.4s |
| After: ALL | 15 | 132 | 100.00% | 100.00% | 100.00% | 4.9s |

Coverage did not show loss in the tested source scope. Semantic review was also performed for the critical invariant families; no assertion was removed solely because coverage remained unchanged.

## Duplicate analysis

- Tests merged into new owners: 132 retained tests across 15 files.
- Duplicate test assertions deleted: 0.
- Original file containers removed: 26, replaced by consolidated tier files.
- Unique critical assertions lost: 0.
- Delta comparison: the new CORE+REGRESSION suite retained 125 original assertions, and the ALL suite retained all 132. Coverage remained 100/100/100 in both comparisons.

The apparent overlap is mostly boundary-specific coverage: EvidenceLedger versus AO orchestration, runtime/account normalization versus HTTP presentation, and unit selector normalization versus finalizer integration. Those layers were consolidated into clear owners without discarding the distinct assertions.

## Critical invariant audit

- verified-only output: retained and passing
- provider identity and domain provenance: retained and passing
- observed + detail-verified final eligibility: retained and passing
- compound identity and historical/two-digit routing: retained and passing
- Luna forbidden-tool and unledgered-tool rejection: retained and passing
- NOT_FOUND versus provider-error semantics: retained and passing
- restricted four-tool MCP surface: retained and passing
- Codex authentication isolation and global auth sentinel: retained and passing
- App Server/session contract and bounded diagnostics: retained and passing
- Gemini planner, declared domains, ranking, corroboration cap, and candidateMax: retained and passing
- Gemini support-aware finalization and safe abstention: retained and passing
- legal MCP parser and law-reference verification: retained and passing
- MCP timeout/retry, abort, HTTP trust, and secret redaction: retained and passing
- no production search behavior, auth behavior, model policy, prompt, dependency, or provider version changed

## Experimental tests

Both diagnostic suites were moved out of the packaging path without changing their production activation:

- `geminiDiagnosticTrace.test.js` remains opt-in under `test/experimental/`.
- `geminiRefinedPlan.test.js` remains opt-in under `test/experimental/`.

## Final npm scripts

- `npm test`: CORE only
- `npm run test:regression`: CORE + REGRESSION
- `npm run test:experimental`: EXPERIMENTAL only
- `npm run test:all`: all tiers
- `npm run verify`: syntax check + CORE + REGRESSION
- `npm run test:coverage:core`
- `npm run test:coverage:regression`
- `npm run test:coverage:all`

`scripts/check.mjs` now recursively syntax-checks tiered test directories so moved tests remain covered by the check gate.

## Final verification

- `npm run check`: PASS, 67 JavaScript/module files
- `npm test`: PASS, 106/106 CORE tests
- `npm run test:regression`: PASS, 125/125 tests
- `npm run test:experimental`: PASS, 7/7 tests
- `npm run test:all`: PASS, 132/132 tests
- `npm run verify`: PASS
- `npm audit --omit=dev --audit-level=high`: PASS, 0 vulnerabilities
- `git diff --check`: PASS
- production source diff: none
- dependency/package-lock diff: none

## Remaining risks

- The 100% coverage figures describe the Node built-in coverage include scope used here; they are not a substitute for live provider or clean-machine packaging QA.
- No live Gemini/Luna calls were made because this milestone is test-structure-only.
- No test framework or runtime dependency was added.

## Decision

`TEST_SUITE_CONSOLIDATION_PASS`
