# Packaging

## 1. Packaging scope

Packaging turns the source checkout into a self-contained Windows application
payload. The canonical layout and include/exclude contract is
`packaging/runtime-manifest.json`.

The repository defines and verifies the staging contract and contains the
NSIS installer recipe. The NSIS compiler remains an external build tool and
installer binaries are build outputs, not source-controlled product files.

## 2. Install layout

The planned installer entry point is `CaseFinderSetup.exe`, with the default
install root `%LOCALAPPDATA%\CaseFinder`:

```text
%LOCALAPPDATA%\CaseFinder\
├── app\
│   ├── src\
│   ├── public\
│   ├── prompts\
│   ├── node_modules\
│   ├── package.json
│   └── package-lock.json
├── runtime\
│   └── node\
│       └── node.exe
├── assets\
│   └── case-finder.ico
└── logs\
```

`start.bat` selects `runtime/node/node.exe` when the managed layout is
present. A source checkout may use the locally installed `node.exe`, but the
release payload must contain the managed runtime.

## 3. Managed Node

The release runtime is the official Windows x64 Node.js `v24.14.0` binary at
`runtime/node/node.exe`. It satisfies the product range `>=24.14.0 <25`.

The binary is provisioned by the packaging build and is ignored by Git. It is
not downloaded or installed on first product launch. A packaging build should
verify the official archive checksum before placing the binary in the staging
payload.

The packaged Codex app-server is pinned to `@openai/codex` `0.147.0` and the
Windows x64 platform package. The runtime resolver checks that the executable
and required dynamic-tool app-server capabilities are present.

## 4. Runtime payload

The payload includes:

- production `src/` and `public/`;
- production dependencies installed into `app/node_modules/`;
- `prompts/plan.txt` and `prompts/select.txt`;
- `config.js`, `package.json`, and `package-lock.json`;
- `.env.example`, `start.bat`, and `assets/case-finder.ico`;
- managed Node at `runtime/node/node.exe`.

The payload excludes:

- `.git/`, `.github/`, `docs/`, and all test directories;
- `state/`, `logs/`, coverage, `dist/`, and source `release/` directories;
- `.env` and any private credentials;
- `runtime/codex/` and other development-only runtime data;
- experimental `refine-plan.txt`;
- arbitrary `.exe` and `.zip` files not explicitly included by the manifest.

The verification reports in `docs/reports/` are repository evidence, not
product runtime resources.

`start.bat` cannot embed a custom Windows icon because batch files do not carry
icon resources. The installer or a Windows shortcut targeting `start.bat` must
use `assets/case-finder.ico` as its icon location.

## 5. Dependency installation and prune

Dependencies are installed during packaging, never by the packaged product
at runtime:

```powershell
Push-Location <staging-root>\app
npm.cmd ci --omit=dev
Pop-Location
node packaging/prune-staging.mjs --stage <staging-root> --level all
```

Run the prune script from the repository checkout, or use its absolute path.
It removes only declared optional payloads under `node_modules` and fails
closed if an expected target is missing or escapes that directory.

The runtime dependency set is fixed by `package.json` and the lockfile:

- `@google/genai`
- `@modelcontextprotocol/sdk`
- `@openai/codex`
- `dotenv`
- `korean-law-mcp`

Do not add a packaging-only runtime dependency without explicit approval and
corresponding manifest/test updates.

## 6. Runtime manifest and preflight

Before an installer is built, verify that every path in the manifest's
`include` list exists in staging and every `exclude` path is absent. In
particular, confirm:

- managed Node reports a supported version;
- `app/node_modules/@openai/codex` and its Windows x64 runtime are present;
- the app server resolves only the packaged Codex runtime;
- `.env`, `state/`, docs, tests, and development handoff files are absent;
- `prompts/plan.txt` and `prompts/select.txt` are present;
- `start.bat` points at the managed layout.

The managed health/capability check can be run against staging with:

```powershell
npm.cmd run verify:managed -- --install-root <staging-root> --skip-query
```

For a live Luna acceptance check, use a dedicated staging `state/` and omit
`--skip-query` only when the external account and provider checks are
explicitly authorized. Do not copy source-checkout authentication into a
release artifact.

## 7. Installer build

`packaging/build-staging.mjs` assembles an external, initially empty staging
root from the approved source files. It deliberately omits dependencies so a
clean `npm ci --omit=dev` can populate `app/node_modules/` in the staging
root. `packaging/prune-staging.mjs` then removes the approved optional native
payloads, and `packaging/CaseFinder.nsi` compiles the per-user installer.

Run the build with an externally provisioned NSIS compiler and an output path
outside the repository when possible:

```powershell
.\packaging\build-installer.ps1 `
  -StageRoot "$env:TEMP\CaseFinder-staging" `
  -OutputPath "$env:TEMP\CaseFinderSetup.exe"
```

The staging root must be empty and outside the source checkout. The installer
uses `%LOCALAPPDATA%\CaseFinder`, requests the normal user execution level,
and keeps `.env`, `state/`, and `logs/` outside the immutable replacement and
normal uninstall sets.

## 8. Clean-machine acceptance

Run this protocol after the installer exists:

1. Start from a clean supported Windows environment.
2. Install Case Finder.
3. Open administrator settings.
4. Save an OC value and Gemini API key supplied for the test account.
5. Run one Gemini natural-language search.
6. Complete Codex authentication in the Case Finder-owned state.
7. Run one Luna natural-language search.
8. Run one case-number direct search.
9. Confirm only verified results are displayed.
10. Exit and relaunch; confirm settings and authentication state persist.
11. Uninstall.
12. Confirm the intended application/runtime/state remnants are removed or
    explicitly documented.

Record live results in `docs/reports/`; do not turn acceptance output into a
runtime dependency or a product prompt.

