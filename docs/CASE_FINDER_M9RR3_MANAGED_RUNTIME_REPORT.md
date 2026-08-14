# Case Finder M9RR3 Managed Runtime Report

## Final status

`M9RR3_MANAGED_RUNTIME_PASS`

Managed Node, stable Codex standalone, adjacent code-mode host, authenticated `codex exec`, restricted MCP, `/health`, and the Luna golden request all passed in the managed-layout verification. The same golden was rerun after the runtime issue was resolved and returned a verified-only `SUCCESS` result.

## Revisions and scope

- Base revision: `4909e07871bf7d6d898255bf3d88d325f4a40c0c`
- Implementation revision: `72914a7db23028af8ec4187bf6c39908c4d96c96`
- Product adapters changed: none
- Luna search algorithm, prompt, policy, tool surface, EvidenceLedger, and FinalSelectionGate changed: none
- Private handoff, G30, and blind-evaluation artifacts: preserved and not staged

## Runtime decision

The previous managed smoke used `0.147.0-alpha.6.5` because that was the locally observed Codex plugin-appserver binary already paired with an adjacent code-mode host during the earlier M9RR2 validation. It was an observed local runtime, not a product-installation guarantee.

The stable standalone candidate `0.147.0` was then selected from the official Codex release package for `x86_64-pc-windows-msvc`. The downloaded package SHA-256 was verified before use:

`c156c8feb8cb20197bf74d2c6daffed1fec0a8c21a03bc2ca90d7ff81927b0c5`

Sources used for the package decision:

- https://github.com/openai/codex/releases
- https://github.com/openai/codex/blob/main/scripts/install/install.ps1

## Managed layout

The managed install root is `%LOCALAPPDATA%\Fable\CaseFinder`:

```text
app\src
app\public
app\prompts
app\node_modules
runtime\node\node.exe
runtime\codex\bin\codex.exe
runtime\codex\bin\codex-code-mode-host.exe
runtime\codex\codex-resources\codex-command-runner.exe
runtime\codex\codex-resources\codex-windows-sandbox-setup.exe
runtime\codex\codex-path\rg.exe
state\codex-home
logs
```

`src/runtimePaths.js` is the single path source. The Windows resolver checks candidates in this order:

1. managed Codex under the install root;
2. explicit developer `CODEX_CLI_PATH`;
3. `where.exe codex.exe` PATH results.

Each candidate must have the CLI, adjacent code-mode host, and a successful `--version` check. Broad user-profile, AppData, Program Files, and recursive local search is not part of the product contract. Luna child processes receive the dedicated install-root `CODEX_HOME`; Case Finder secrets remain excluded.

`start.bat` uses the managed Node executable and does not run `npm ci` in the installed layout. `/health` reports Luna readiness without making an LLM query. `src/verifyManagedRuntime.js` performs managed file/version checks, server health, restricted MCP startup, and the Luna golden request.

## Runtime smoke evidence

| Check | Result |
|---|---|
| Previous alpha `0.147.0-alpha.6.5` standalone authenticated smoke | PASS; exit 0, auth marker observed, about 4 s, final event `turn.completed` |
| Stable `0.147.0` standalone authenticated smoke | PASS; exit 0, auth marker observed, about 7.3 s, final event `turn.completed` |
| Stable restricted MCP minimum smoke | MCP process connected and `korean_law.search_law` was started/completed; exit 0, about 15.9 s; the stdin-only smoke query was damaged by PowerShell code-page conversion, so it was not used as a legal-result correctness check |
| Managed `/health` | HTTP 200; `mcp.connected=true`; Codex and code-mode host readiness true |

## Golden evidence

Golden query: `임차보증금을 돌려받지 못했을 때`

The final same-golden rerun used managed Node `v24.14.0` and managed Codex `codex-cli 0.147.0`:

- HTTP status: `200`
- stage: `LUNA_NATIVE`
- terminal state: `SUCCESS`
- last successful AO event/state: `MODEL_FINAL`
- restricted legal MCP calls: `9` total (`search` 4, `detail` 5)
- protocol pass: `true`
- output valid: `true`
- model protocol clean: `true`
- verified items: `4`
- measured `/ask` wall-clock elapsed: `25,895 ms`
- forbidden tool contamination: `0`

The earlier successful same-golden rerun also passed (`SUCCESS`, 3 verified items). The final rerun above is the evidence used for the runtime pin.

## Timeout classification

The original alpha managed golden ended in `CODEX_NATIVE_SESSION_TIMEOUT` before a verified-only result. The controlled checks classify that failure as an alpha managed-runtime compatibility/interaction issue, not an authentication, generic process-spawn, restricted MCP, Law.go.kr, model-final-artifact, or FinalSelectionGate failure:

- authentication passed independently on both alpha and stable standalone `codex exec`;
- stable restricted MCP connected and completed a tool call;
- stable managed `/health` connected the restricted MCP and found both Codex executables;
- stable managed golden completed legal search/detail calls and returned a verified-only final artifact.

The stable `0.147.0` runtime resolved the timeout without changing the search algorithm, prompt, policy, restricted tool set, EvidenceLedger, or FinalSelectionGate.

## Verification commands

- `npm run check`: PASS
- `npm run verify`: PASS
- `node --test test/runtimeHardening.test.js`: PASS
- `npm run verify:managed -- --install-root <temporary-managed-root> --query "임차보증금을 돌려받지 못했을 때"`: PASS; repeated after the runtime fix
- Browser/Playwright UI verification: not run in this implementation turn

## Manifest decision

`packaging/runtime-manifest.json` pins Codex `0.147.0`, target `x86_64-pc-windows-msvc`, the verified package SHA-256, the adjacent code-mode host, and the official package helper/resource files. The installer still provisions a dedicated `CODEX_HOME`; user authentication remains an install-time/runtime setup concern and is not copied into the package.
