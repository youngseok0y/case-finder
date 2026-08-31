# Case Finder Final Pre-Packaging Hardening Report

Date: 2026-08-31
Branch: `release`
HEAD: `8def672 Merge main into release`
Baseline main: `e41b6f6 Merge branch 'fix/final-prepackage-hardening'`

## Baseline

The hardening work was performed on the isolated branch above. The source
checkout uses Node `v24.19.0` and npm `11.17.0`, within the configured Node
range `>=24.14.0 <25`. The acceptance run provisioned the pinned private Node
`v24.14.0` under `runtime/node/node.exe` from the official Windows x64 archive
after SHA-256 verification. The only pre-existing untracked file is the user-owned
handoff document `docs/Case Finder — Final Pre-Packaging Hardening Handoff.md`;
it was preserved and was not staged. The private Node binary is an ignored
build artifact and was not staged.

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

`npm run verify:managed -- --install-root <staging> --skip-query` passed with:

```text
M11_CODEX_APP_SERVER_PASS
nodeVersion: v24.14.0
dynamicTools: true
mcpConnected: true
```

The temporary staging payload used `runtime/node/node.exe` as the server
launcher. Codex app-server `0.147.0`, dynamic tools, health, and MCP startup
all passed. The staging payload did not include system Node/npm on its runtime
PATH.

## Gemini live smoke

Three representative natural-language requests were run once each through the
staging payload and managed Node:

| query shape | status | terminal state | items | result condition |
| --- | ---: | --- | ---: | --- |
| 임차보증금 반환 | 200 | `SUCCESS` | 2 | verified-only |
| 계약 해지 손해배상 | 200 | `SUCCESS` | 3 | verified-only |
| `임대차 계약 해지 손해배상 $100` | 200 | `NO_RESULT` | 0 | no forced fill |

Gemini live smoke is `3/3` process-successful with no unsupported output.

## Luna live smoke

The dedicated `state/codex-home` authentication was used only in the temporary
staging state. Three requests ran once through one persistent staging server;
the first two were back-to-back. All returned HTTP 200 with `LUNA_NATIVE`,
`SUCCESS`, and four verified-only items. No global Codex home was used and no
Gemini fallback was introduced.

## Direct-route smoke

Three one-shot staging requests were used to inspect routing and provider
identity:

| input class | observed route | provider result |
| --- | --- | --- |
| `99두2963` | `DIRECT` | HTTP 200, one verified item |
| `2023두54914` | `DIRECT` | HTTP 200, one verified item |
| `2014두12598, 12604` | `DIRECT` | HTTP 200, one verified item |

All three used the managed Node launcher and preserved the provider-verified
direct result contract.

## Packaging staging dry-run

The staging dry-run completed outside the source checkout:

- clean `npm ci`: 194 packages installed
- prune: six declared dependency targets removed
- manifest include preflight: all paths present
- forbidden payload paths: `.env`, docs, tests, `runtime/codex`, and
  `refine-plan.txt` absent
- managed Node: `v24.14.0`
- installer: not built by design

The temporary staging directory was removed after verification.

## Remaining known issues

1. Build the installer in the separate installer phase; this acceptance run
   intentionally stopped before NSIS/installer construction.
2. The private Node binary must be provisioned by the future packaging build
   rather than committed to Git.

These are release-gate dependencies, not new production-code findings. No
additional tuning or refactoring was performed.

## Production freeze recommendation

Keep production source code frozen at the accepted main merge. Only the
separate installer/build phase remains after this pre-package gate.

## Decision

```text
FINAL_PREPACKAGE_HARDENING_PASS
```

The 41 finding closure is complete. Deterministic verification, 100/100/100
coverage, zero high-severity production audit findings, managed runtime,
staging validation, Gemini smoke, Luna smoke, and direct-route smoke all pass.
Installer construction remains intentionally outside this pre-package gate.
