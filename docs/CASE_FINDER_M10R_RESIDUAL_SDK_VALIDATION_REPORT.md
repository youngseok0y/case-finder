# M10-R Residual SDK Validation

Base SHA: `e846c75`
Final SHA: `1a1d545` (validation implementation commit)
Branch: `codex/m10r-codex-sdk`

## Known limitation — Codex user configuration inheritance

Luna SDK execution reuses the user's existing Codex home for authentication and therefore may inherit user-configured MCP servers, providers, hooks, or rules. Case Finder does not guarantee complete Codex-session isolation from those settings. Unapproved MCP execution is detected and aborts the AO session before its result can enter `LegalToolGateway`, `EvidenceLedger`, or `FinalSelectionGate`. Case Finder secrets are excluded from the Codex child environment.

### Case Finder guarantees

1. Unverified external MCP results are never used as legal evidence.
2. External MCP results do not enter `EvidenceLedger`.
3. Unverified precedents do not pass `FinalSelectionGate`.
4. Case Finder-specific secrets are not passed to the Codex runtime.

### Case Finder does NOT guarantee

5. The Codex session is completely isolated from the user's existing Codex config, MCP, or provider settings.

## B. Packaged runtime preflight

Result: `PASS`

Evidence:

- current custom preflight: resolves `@openai/codex-win32-x64`, target `x86_64-pc-windows-msvc`, `codex.exe`, and `codex-code-mode-host.exe`.
- actual SDK resolver: `new Codex()` and `startThread()` were executed at the pinned `@openai/codex-sdk@0.147.0` / `@openai/codex@0.147.0` versions. Both succeeded and returned the SDK thread interface.
- false-positive readiness possible: reduced. Preflight now verifies the SDK constructor and thread boundary in addition to package files; the fake-boundary test asserts the pinned model, `medium` reasoning, read-only sandbox, and restricted MCP configuration.
- final readiness implementation: `inspectPackagedCodexRuntime()` performs the non-billable SDK constructor/thread probe.
- model/network call required for health: NO. `run()` and `runStreamed()` are not called by health/preflight.

## C. Timeout / abort

Result: `PASS`

Evidence:

- timeout test: deterministic short-timeout fake SDK stream received `AbortSignal`, returned `CODEX_NATIVE_SESSION_TIMEOUT`, and did not queue a final.
- close/abort test: `session.close()` aborted an active stream and resolved without a final event.
- false-success test: `finalQueued` remained false after timeout and close.
- unhandled rejection: none; the deterministic tests completed cleanly.

## Frozen invariants

Luna prompt changed: NO
Model changed: NO
Reasoning effort changed: NO
MCP tool surface changed: NO
EvidenceLedger changed: NO
FinalSelectionGate changed: NO
Gemini D changed: NO

## Verification

npm run check: PASS
npm run product:test: PASS, 60/60
npm run verify: PASS, 60/60
git diff --check: PASS; only Git line-ending normalization warnings were reported.

## M10-R final recommendation

`M10R_CODEX_SDK_PASS`

Reason: packaged-runtime readiness and timeout/abort behavior are verified, and the product security contract guarantees that unverified external MCP results cannot enter the legal evidence path or pass final selection. The Codex user-configuration inheritance behavior remains documented as the single known limitation above.
