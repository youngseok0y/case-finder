# Development

## 1. Development environment

Case Finder is developed and run on Windows with:

- Node.js `>=24.14.0 <25`;
- npm compatible with the installed Node.js;
- network access to the configured legal provider for live searches;
- a Gemini API key for `gemini_d` checks;
- a dedicated Codex login for `luna_native` checks.

The repository does not commit private keys, Codex authentication, managed
runtime binaries, or generated local state.

## 2. Prepare the repository

From the repository root:

```powershell
npm.cmd ci
```

For a local settings file, copy `.env.example` to `.env` and fill only the
values needed for the selected route. The administrator screen can also write
the supported settings without manually editing `.env`.

Never commit `.env`, API keys, Codex auth files, or files under `state/` and
`logs/`.

## 3. Local configuration

The supported environment settings are:

| Variable | Purpose | Default |
| --- | --- | --- |
| `LAW_OC` | Korean legal provider OC credential | empty |
| `GEMINI_API_KEY` | Gemini API credential | empty |
| `SEARCH_ADAPTER` | `gemini_d` or `luna_native` | `luna_native` |
| `PORT` | Local HTTP port | `3300` |
| `CODEX_TIMEOUT_MS` | Luna turn timeout, with a 30-second minimum | `120000` |
| `CODEX_WORKDIR` | Optional Codex session work directory | install-root state path |

`CASE_FINDER_ENV_PATH`, `CASE_FINDER_APP_ROOT`, and
`CASE_FINDER_INSTALL_ROOT` are runtime path overrides used by managed and
packaged launches. The normal source checkout should not need them.

## 4. Run locally

The development server can be started with:

```powershell
npm.cmd run start
```

The Windows launcher provides the same product entry point plus Node-version,
dependency, port, health, restart, and stop checks:

```powershell
./start.bat
```

The default URL is `http://127.0.0.1:3300`. Use the administrator screen to
configure credentials and choose one of the two supported adapters.

For Luna login in a source checkout, use `codex-login.bat`. It targets the
repository's dedicated `state/codex-home`; it must not be changed to use a
user-global Codex home.

## 5. Test commands

The default suite is network-free and uses deterministic fixtures.

```powershell
npm.cmd test
npm.cmd run test:regression
npm.cmd run test:all
npm.cmd run test:coverage:core
npm.cmd run test:coverage:regression
npm.cmd run test:coverage:all
```

`npm test` runs the core suite. `test:regression` and `test:all` run the core
plus regression suites. Coverage commands use Node's built-in test coverage.
There is no experimental test tier in the current production repository.

## 6. Required verification

Before delivering code changes, run:

```powershell
npm.cmd run verify
git diff --check
```

`npm run verify` performs JavaScript/module syntax checks and the core plus
regression tests. A managed-runtime check is separate because it needs the
private Node payload and installed Codex runtime:

```powershell
npm.cmd run verify:managed -- --install-root <staging-root> --skip-query
```

Omit `--skip-query` only for an explicitly authorized live Luna check. Record
live provider or model checks separately from the deterministic default suite.

## 7. Safe change checklist

Before opening a change for review, confirm:

- provider verification and the evidence ledger are still mandatory;
- no unverified candidate reaches the public response;
- direct-route and compound-case identity behavior is preserved;
- Gemini and Luna adapter contracts remain separate;
- the four-tool legal MCP surface is unchanged;
- Codex authentication remains inside the dedicated product home;
- no raw token, private reasoning, prompt, or provider-secret detail is
  exposed;
- no runtime dependency is added or changed without explicit approval;
- managed runtime and packaging resources remain consistent;
- `npm.cmd run verify` and `git diff --check` pass.

When removing dead code, search the whole repository for its symbol or path
first. Preserve unrelated tracked modifications and untracked private
evaluation artifacts.

## 8. Directory map

| Path | Responsibility |
| --- | --- |
| `src/server.js`, `src/httpApi.js` | HTTP server, health, ask, SSE, and admin boundaries |
| `src/searchAdapters/` | Adapter catalog, registry, and adapter contracts |
| `src/nlPipeline.js`, `src/gemini.js` | Gemini deterministic retrieval and selection pipeline |
| `src/aoV2/` | Luna Native evidence, legal gateway, safety, and finalization |
| `src/directLookup.js`, `src/router.js` | Case-number routing and direct legal lookup |
| `src/codex*.js` | Codex runtime, session, account, model, and auth isolation |
| `public/` | Browser UI and public status rendering |
| `prompts/` | Production Gemini prompts included by packaging |
| `test/core/` | Fast product and contract tests |
| `test/regression/` | Fault-injection and historical regression tests |
| `packaging/` | Runtime manifest and staging prune contract |
| `runtime/node/` | Local managed Node payload; not committed |
| `state/`, `logs/` | Local auth/runtime state and logs; not release payload |
| `docs/reports/` | Historical verification and acceptance evidence |

