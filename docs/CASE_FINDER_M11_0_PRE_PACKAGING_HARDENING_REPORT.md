# Case Finder M11-0 Pre-Packaging Hardening Report

Terminal: M11_0_HARDENING_PASS
Base SHA: 6dae9136c9b6aec275f67b939157f6ee93779859
Final SHA: b7ef763
Branch: m11-0-pre-packaging-hardening
Publish commit: b7ef763 ([M11-0] Harden pre-packaging runtime paths and local requests)
Baseline tag: milestone/m11-0-hardening

Node: v24.14.0
npm: 11.12.1
OS: Windows 10.0.19045.0 / AMD64

## H1 Windows file URL

Result: PASS
Implementation: `fileURLToPath(packageJsonPath)` is used before `path.dirname`; pathname replacement and `decodeURIComponent` are not used.
ASCII path test: PASS
Space path test: PASS
Korean path test: PASS
Real Windows integration: Deterministic preflight used real temporary Windows paths and real filesystem entries. Installed packaged Codex binary execution was not separately run.

## H2 Auth classification

Result: PASS
Positive auth fixtures: 11 required messages plus nested SDK error object.
Negative token-limit fixtures: 5 token-budget/context messages remain non-auth failures.
Raw error leakage: PASS for the product response envelope and existing SDK failure regression; raw SDK diagnostics are not rendered to the UI.

## H3 HTTP client errors

Result: PASS
Malformed /ask: HTTP 400 with safe JSON message.
Oversized /ask: HTTP 413 at the 10,000-byte bound.
Malformed admin: HTTP 400 with safe JSON message.
Invalid admin: HTTP 400 with safe field-level reason; secrets are not echoed.
Valid admin write: HTTP 200 and allowlisted field write path verified.
Real server failure regression: HTTP 500 remains a server failure.

## M2 MCP timeout/reconnect

Result: PASS
Timer cleanup: `finally` clears the timeout timer on resolve, reject, and timeout.
Timeout error: Stable `MCP_CALL_TIMEOUT` code.
Timeout destroys transport: NO
Automatic timeout retry: NO
Transport reconnect: Real transport failures perform one bounded close/reconnect/retry sequence.
Concurrent slow/fast test: PASS; slow timeout did not close transport, affect the fast call, or duplicate the slow call.

## M3 stdio concurrency

Result: PASS
Shared latestRawResult remains: NO
Reverse-completion test: PASS; A/50ms returned RAW_A and B/5ms returned RAW_B.
Ledger correctness: Each request creates a request-scoped LegalToolGateway while sharing the existing ledger, telemetry, and safety controls; both accepted calls were recorded.

## M4 Adapter registry

Result: PASS
Canonical default source: `config.searchAdapter`, passed explicitly by the server caller.
Implicit fallback remains: NO
gemini_d: Explicitly resolves.
luna_native: Explicitly resolves.
unsupported: Fails closed with `SEARCH_ADAPTER_UNSUPPORTED`.

## S1 Localhost trust

Result: PASS
127.0.0.1 Host: Allowed only on the actual `request.socket.localPort`.
localhost Host: Allowed only on the actual local port.
foreign Host: Rejected with HTTP 403 before route handling, including static assets.
local Origin: HTTP local origins on the actual port are allowed.
foreign Origin: Rejected with HTTP 403 on admin, ask, and stream POST routes.
CLI no-Origin: Allowed when the Host is trusted.

## Deferred by scope

M1 no-progress: Deferred.
P1 health cache: Deferred.
P2 performance: Deferred.
P3 preview reduction: Deferred.
D1 legacy deletion: Deferred.
D4 shutdown: Deferred.
dependency purge: Deferred.
packaging: Deferred.

## Frozen invariants

SDK version changed: NO
Luna model changed: NO
Reasoning changed: NO
Gemini model changed: NO
Ranking changed: NO
Candidate limits changed: NO
MCP tools changed: NO
LegalToolGateway changed: NO
EvidenceLedger weakened: NO
FinalSelectionGate changed: NO
Silent fallback changed: NO
Bind address changed: NO; server remains bound to `127.0.0.1`.

## Verification

npm run check: PASS
npm run product:test: PASS, 76 tests
npm run verify: PASS, 76 tests
git diff --check: PASS
Working tree clean: Final report/tag commit clean; pre-existing untracked handoff/G30 materials remain untracked and preserved.

## User-path smoke

99두2963: PASS; HTTP 200 DIRECT/SUCCESS with verified case `99두2963`.
Gemini natural: PASS; HTTP 200 GEMINI_D/SUCCESS with 3 verified items and no validation failures.
Luna natural: External blocker; HTTP 503 `CODEX_SDK_EXECUTION_FAILED`. No Gemini fallback occurred. The underlying SDK/provider failure is kept behind the product-safe runtime error boundary.

## M11-A baseline

Frozen SHA: b7ef763 implementation commit.
Tag: milestone/m11-0-hardening
Ready for dependency A/B: YES, after the tagged hardened baseline is used as A0.

## Remaining observations

The installed packaged Codex binary was not exercised as a separate full Windows installation test; H1 used real Windows filesystem paths and a no-network/no-model SDK preflight fixture. Luna user-path smoke remains dependent on the external Codex runtime/provider being available.

## Final recommendation

M11_0_HARDENING_PASS
