# Case Finder

Case Finder is a local Fable-format legal precedent search application. It retrieves provider-authored Korean legal source material through the restricted legal MCP surface and shows only verified results.

## Current product boundary

- Product adapters: `gemini_d` and `luna_native`
- Search configuration is frozen: `SEARCH_DISPLAY=20`, `candidateMax=20`
- Gemini: pinned deterministic plan/selection flow with `gemini-3.5-flash-lite`
- Luna: Native AO-v2 with `gpt-5.6-luna` and `medium` reasoning
- Legal MCP tools: `search_decisions`, `search_law`, `get_decision_text`, `get_law_text`
- Final cases require provider-observed identity and successful detail verification
- Luna keeps `EvidenceLedger`, `FinalSelectionGate`, and verified-only output
- Provider failures are not silently changed to another adapter

## Requirements

- Windows local runtime or Node.js `>=24.14.0 <25`
- A configured law.go Open API credential in `.env` as `LAW_OC`
- `GEMINI_API_KEY` for the Gemini adapter
- Packaged installations provide private Node.js and the pinned Codex SDK runtime

## Development

```powershell
npm ci
npm start
npm run verify
```

The server binds to `127.0.0.1`. In a source checkout, `start.bat` uses the local `node.exe` on `PATH` when the packaged runtime is absent. `npm run verify` performs the syntax check and the network/model-free product test suite. `npm run verify:managed -- --skip-query` checks the packaged runtime contract without making a live legal query.

For development-only Codex re-authentication, run `codex-login.bat` from the repository root. It requires local Node.js `>=24.14.0 <25` and the Windows x64 Codex package installed by `npm ci`; it does not copy, parse, or delete authentication files. The helper is checkout-specific and is not the managed installer entrypoint.

## Configuration

Use `.env.example` as the template. `SEARCH_ADAPTER` accepts only `gemini_d` or `luna_native`. Search depth and candidate limits are intentionally fixed at 20 for the pre-release product baseline.

## Packaging

`packaging/runtime-manifest.json` describes the managed installation layout. `packaging/prune-staging.mjs` applies the validated dependency allowlist during staging; it refuses targets outside the staging `node_modules` directory.

The application must not expose provider credentials, private reasoning, system prompts, raw tool planning, or authentication tokens in the UI or logs.
