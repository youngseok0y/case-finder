# M10-R Residual SDK Validation

Base SHA: `e846c75`
Final SHA: pending validation commit
Branch: `codex/m10r-codex-sdk`

## A. User config isolation

Result: `SDK_STOP`

Evidence:

- user config.toml loaded: YES. The current user config contains `mcp_servers.node_repl` and `mcp_servers.korean-law`. Packaged `codex mcp list` confirmed both entries.
- foreign MCP contamination possible: YES at SDK/Codex configuration discovery. Adding the Case Finder `korean_law` override does not remove the existing user MCP entries.
- hooks/rules influence possible: the current user config has no hook or rule section; the SDK TypeScript `ThreadOptions` also exposes no `ignoreUserConfig` or `ignoreRules` option. The Case Finder thread uses a temporary working directory, so repository-local rules are not loaded from the Case Finder checkout.
- Case Finder restriction remains authoritative: PASS for the product evidence boundary. A deterministic foreign `node_repl` MCP event is rejected as `AO_V2_LUNA_TOOL_CONTAMINATION` before `LegalToolGateway` or `EvidenceLedger` receives it.
- changes made: added the foreign-MCP rejection test only; no custom CLI argument injection, SDK patch/fork, App Server client, auth-file copy, or credential manager was added.

The stock TypeScript SDK does not provide a public way to pass the CLI's `--ignore-user-config` / `--ignore-rules` flags. Therefore strict process-level isolation of every user-configured MCP cannot be proven within the bounded SDK-only architecture. Achieving that stronger condition would require one of the prohibited expansion paths, so the residual gate is `SDK_STOP` rather than an overstated PASS.

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

`SDK_STOP`

Reason: packaged-runtime readiness and timeout/abort behavior are verified, and foreign MCP results are blocked from the legal evidence path. However, the current official TypeScript SDK loads the user's existing Codex configuration and does not expose the CLI's user-config/rules isolation flags. Strict proof that all foreign configured MCP processes cannot execute would require a custom CLI argument layer, SDK modification, App Server integration, or a new credential/configuration manager, all explicitly outside the bounded M10-R scope.
