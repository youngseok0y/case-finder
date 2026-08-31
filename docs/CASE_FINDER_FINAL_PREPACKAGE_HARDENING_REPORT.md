# Case Finder Final Pre-Packaging Hardening Report

Date: 2026-08-28
Branch: `fix/final-prepackage-hardening`
HEAD: `79bfd92 fix: finalize runtime lifecycle and efficiency`
Baseline main: `df4de46 refactor: consolidate final test suite`

## Baseline

The hardening work was performed on the isolated branch above. The source
checkout uses Node `v24.19.0` and npm `11.17.0`, within the configured Node
range `>=24.14.0 <25`. The only pre-existing untracked file is the user-owned
handoff document `docs/Case Finder — Final Pre-Packaging Hardening Handoff.md`;
it was preserved and was not staged.

The Phase 8 audit added only this report and the closure matrix. No production
code, prompt, model, ranking, adapter, dependency manifest, or packaging
resource was changed during Phase 8.

## Fable review scope

The handoff defines 10 top confirmed findings plus 31 additional verified
findings. Its 40 numbered group headings omit the separate HTML decoding rule;
that rule is recorded as `I5`, giving the required 41 closure items.

## 41-finding closure summary

The full matrix is in
[CASE_FINDER_FABLE_FINDINGS_CLOSURE.md](./CASE_FINDER_FABLE_FINDINGS_CLOSURE.md).

| disposition | count |
| --- | ---: |
| FIXED | 24 |
| REMOVED | 8 |
| CONSOLIDATED | 9 |
| REFUTED | 0 |
| OPEN | 0 |
| total | 41 |

All findings have explicit closure entries. `OPEN=0` applies to the finding
matrix; it does not override the separate external managed/live/package gates
below.

## App Server fixes

The hardening commits cover usage-write recovery, early completion buffering,
duplicate completion idempotency, closed-stdin response containment, startup
handshake/auth isolation, and deterministic missing-gateway errors. Fault
injection regressions exercise each path.

## Evidence fixes

Provider-verified evidence is monotonic across failed re-fetches. Canonical
case identity is separated from direct-route eligibility, while compound and
unknown provider identities remain provider-bound. Final selection remains
verified-only and the restricted legal tool surface remains unchanged.

## Gemini fixes

Abort propagation, safe prompt replacement, explicit selector outcomes, and
removal of refined-search/diagnostic experimental paths are covered. The
Gemini model pin, planner/selection intent, request budget, ranking behavior,
and production adapter ID remain unchanged.

## Windows/packaging fixes

Launcher delayed-expansion and stale-PID handling were hardened. Managed
health JSON retry, prune validation, and runtime-resource manifest tests pass.
The manifest excludes the removed `refine-plan.txt` resource and still names
the live plan/select prompts and runtime dependencies.

## Dead-code removal

The refined-search path, M6E diagnostic trace machinery, obsolete Gemini
injection surfaces, dead rate-limit branches/constants, zero-caller standalone
API, retained `lastRun`, and obsolete experimental test tier were removed.
Repository-wide source/runtime/test/script searches found no unintended
references to the retired symbols. The only `refine-plan.txt` occurrence in
the tested tree is an intentional negative manifest assertion.

## Duplicate consolidation

Decision links, law-reference dedupe, small text normalization, MCP tool text
extraction, and Gemini pipeline result handling now have canonical bounded
implementations. No broad abstraction layer was introduced.

## Contract/taxonomy consolidation

Legal MCP result classification, Codex error categories, adapter metadata, and
`SEARCH_FAILED` wording are centralized. Public responses continue to omit
private reasoning, raw planning, auth tokens, and internal support fields.

## Efficiency/lifecycle changes

Account/rate-limit reads use bounded cache semantics; law enrichment shares
duplicate in-flight/resolved work with concurrency capped at two; health work
parallelizes independent checks and caches immutable runtime resolution. The
deterministic fixture evidence is recorded in the closure matrix, with no
provider benchmark or arbitrary speed target.

## Deleted production code/resources

- `prompts/refine-plan.txt`
- `test/experimental/geminiDiagnosticTrace.test.js`
- `test/experimental/geminiRefinedPlan.test.js`
- production refined-search, M6E trace, stale `lastRun`, and zero-caller
  compatibility paths listed in the closure matrix

## Added regression tests

The final suite contains fault-injection coverage for App Server lifecycle,
evidence monotonicity, prompt token insertion, HTML decoding, chunked 413,
ISO reset formatting, managed health retry, Windows launcher safety, law-call
deduplication, future Codex error categories, and the product contract.

## Test-suite final shape

There are 13 test files: 10 CORE files and 3 REGRESSION files. The experimental
tier and its npm scripts are removed.

| command scope | tests | result |
| --- | ---: | --- |
| `npm test` / CORE | 128 | PASS |
| `npm run test:regression` | 150 | PASS |
| `npm run test:all` | 150 | PASS |
| `npm run verify` | 150 plus syntax check | PASS |

## Coverage before/after

The recorded pre-hardening consolidated baseline was already 100/100/100 for
the defined source scope. Final core, regression, and all coverage runs each
remain:

```text
line:     100.00%
branch:   100.00%
functions:100.00%
```

## Audit

After refreshing the workspace from the lockfile, the exact dependency checks
reported:

- `korean-law-mcp@4.12.1`
- `@openai/codex@0.147.0`
- `pdfjs-dist@4.10.38` as the lockfile-selected korean-law-mcp dependency
- `npm audit --omit=dev --audit-level=high`: `found 0 vulnerabilities`
- `git diff --check`: PASS

No package manifest or lockfile change was made by Phase 8.

## Managed-runtime result

`npm run verify:managed -- --skip-query` is BLOCKED with:

```text
M11_CODEX_APP_SERVER_BLOCKED
MANAGED_FILE_MISSING: managed node:...\runtime\node\node.exe
```

The source checkout has no packaged private Node runtime, so managed app-server
capability verification and managed golden query cannot be declared PASS.

## Gemini live smoke

Three natural-language requests were attempted once each with `gemini_d`.
The server health endpoint was available and MCP transport reported connected,
but all three requests returned HTTP 200 with `GEMINI_D`, terminal state
`SEARCH_FAILED`, and zero items. Each recorded one Gemini request and one MCP
call. The contemporaneous server log recorded `M0 MCP probe failed`.

This is a live gate FAIL, not a verified-only success. No additional Gemini
retry was made.

## Luna live smoke

The dedicated `state/codex-home/auth.json` exists and the dedicated config
uses `cli_auth_credentials_store = "file"`; no global Codex home was used.
The three planned natural-language requests did not produce verified results:
the App Server reported `CODEX_APP_SERVER_TURN_FAILED: turn status: failed`.
An additional one-request diagnostic was run only to recover the missing first
run output and also failed; it was not counted as a pass or used to justify a
fallback. No Gemini fallback was introduced.

This is a live gate FAIL.

## Direct-route smoke

Three one-shot source-checkout requests were used to inspect routing:

| input class | observed route | provider result |
| --- | --- | --- |
| `99두2963` | `DIRECT` | `SEARCH_FAILED`, zero items |
| modern four-digit case | `DIRECT` | `SEARCH_FAILED`, zero items |
| compound/historical identifier | `natural` because the input contained multiple identifiers | `SEARCH_FAILED`, zero items |

The route classification itself showed no regression, but legal-provider
verification was unavailable under the same MCP probe failure. Therefore the
direct-route live gate is not PASS.

## Packaging staging dry-run

Manifest preflight passed for live resource declarations, absence of
`refine-plan.txt`, adapter/dependency metadata, and required source/prompt
paths. The prune fixture and packaging contract tests passed.

A complete staging copy → prune → managed-resource validation could not run
because `runtime/node/node.exe` is absent from the source checkout. No final
installer was built.

## Remaining known issues

1. Provision the managed private Node runtime under `runtime/node/node.exe` and
   repeat managed health/capability verification.
2. Repair or provision the legal MCP live credential/service path so the M0
   probe succeeds, then repeat the three Gemini, three Luna, and direct-route
   smoke gates with retry count zero.
3. Complete the packaging staging dry-run only after the managed runtime and
   live gates pass.

These are release-gate dependencies, not new production-code findings. No
additional tuning or refactoring was performed.

## Production freeze recommendation

Keep production source code frozen at `79bfd92` while the external runtime and
provider prerequisites are repaired. Do not begin installer construction from
this audit result alone.

## Decision

```text
FINAL_PREPACKAGE_HARDENING_PENDING
```

The 41 finding closure is complete and deterministic verification is green,
but the final acceptance token `FINAL_PREPACKAGE_HARDENING_PASS` is not
declared because managed runtime, live provider, direct-route verification,
and complete packaging staging are not all passing.
