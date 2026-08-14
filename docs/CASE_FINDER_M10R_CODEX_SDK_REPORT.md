# Case Finder M10-R Codex SDK Runtime Report

Terminal: `M10R_CODEX_SDK_PASS`
Base SHA: `957793d1672869fbbdaec9f1a376e9d15357470e`
Final SHA: working-tree validation completed; publish commit pending
Publish commit: not created in this implementation turn
Branch: `codex/m10r-codex-sdk`

SDK version: `@openai/codex-sdk@0.147.0`
Resolved Codex version: `@openai/codex@0.147.0`
Platform: Windows x64 (`win32/x64`)
Node: `v24.19.0`
Package manager: npm `11.17.0`

Old runtime boundary: `luna_native` -> Case Finder CLI resolver -> direct `spawn` -> Case Finder-owned JSONL parser.
New runtime boundary: `luna_native` -> `lunaSdkRuntime` -> `@openai/codex-sdk` -> packaged `@openai/codex-win32-x64` -> restricted `korean_law` MCP bridge.

Search logic changed: NO
Luna prompt changed: NO
Reasoning effort changed: NO (`gpt-5.6-luna`, `medium`)
MCP tool surface changed: NO
EvidenceLedger changed: NO
FinalSelectionGate changed: NO
Gemini D changed: NO

CODEX_CLI_PATH required: NO
System PATH Codex required: NO
WindowsApps Codex used: NO
Silent Gemini fallback possible: NO

npm run check: PASS
npm run product:test: PASS, 55/55
npm run verify: PASS, 55/55
git diff --check: PASS; only Git line-ending normalization warnings were reported.

SDK packaged-runtime integration: PASS. The deterministic preflight resolved `@openai/codex-win32-x64`, `x86_64-pc-windows-msvc`, `codex.exe`, and `codex-code-mode-host.exe`. An actual tool-backed `luna_native` invocation completed through the SDK with the pinned `gpt-5.6-luna` / `medium` execution pin and no Gemini fallback. A representative run completed with verified items; a later retry completed as a valid `NO_RESULT`, which is non-blocking under the requested runtime-stability gate.

Luna stable golden: PASS for the M10-R runtime gate. The SDK process, restricted MCP path, canonical response handling, and verified-only pipeline remained operational. Exact golden hit percentage, prose parity, and the private `test/private/m8-golden17-live-final-luna/luna/golden17-records.jsonl` fixture were not used as blocking criteria per the user instruction; the fixture is absent in this checkout.

Browser console: PASS inherited from the M10 product QA report; M10-R adds no browser/UI execution surface. Mobile viewport QA remains excluded from the local-PC release gate.
Direct-success browser case: PASS inherited from the M10 product QA report (`gemini_d`, `2017다292343`); direct Law.go.kr provider availability remains independent of M10-R.

Authentication and privacy: the SDK receives a narrow environment allowlist. An explicit user `CODEX_HOME` is preserved; when it is absent, the runtime derives the user's conventional `.codex` home without copying auth files into the repository. Raw SDK stderr, tool arguments, plans, private reasoning, and secrets are not returned through product payloads.

Runtime failure handling: SDK package, startup, auth, stream, final-response, timeout, and execution failures map to the existing `LUNA_RUNTIME_UNAVAILABLE` boundary. The product message gives an actionable SDK/login/dependency restart path and no longer instructs ordinary users to set `CODEX_CLI_PATH`, locate WindowsApps binaries, or place sibling binaries manually.

Remaining blockers: none for the M10-R runtime-stability objective. Exact golden-quality parity is a non-blocking observation. The separate Law.go.kr direct-success provider QA remains an M10 product-level concern if the upstream is unavailable.
Stop-loss triggered: NO

Note: npm installation reported dependency audit warnings; no unrelated `npm audit fix` mutation was applied.
