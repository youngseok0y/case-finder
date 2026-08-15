# Case Finder M11-B Node Runtime Packaging Report

Terminal: `M11B_PACKAGING_DECISION_PASS`
Decision: `B1_PRIVATE_NODE_ADOPT`

M11-A source SHA: `db547e7841a6aad111b04833cad167e295d8426d`
M11-A decision: `PURGE_ADOPT`
M11-A prune procedure: `scripts/m11a/prune-staging.mjs`
Branch: `m11-b-node-packaging`
Final SHA: `c4e527c75cb6fe9f6aaea3c0148f6fbc3fd31d30` (implementation commit; this report is the following report-only commit)

Node: `v24.14.0`
npm: `11.12.1` (build-only; never used by the staged runtime)
OS: Windows 10.0.19045 x64; 12 logical processors

## Scope and packaging boundary

M11-B consumed the accepted M11-A selective purge in clean temporary staging copies. The source checkout's `node_modules`, package manifest, lockfile, prompts, search behavior, model pins, EvidenceLedger, FinalSelectionGate, restricted legal MCP surface, and quota behavior were not changed.

The only product-path change is a packaging boundary fix in `src/mcpClient.js`: when the managed private Node exists, Windows starts `korean-law-mcp/build/index.js` directly with that executable instead of using the npm `.cmd` shim, which would otherwise require system Node on `PATH`. Developer-mode fallback to the existing `.cmd` path remains available when no managed Node exists.

## B1 Private Node

Assembly: clean source copy → normal `npm ci` in `app/` → `scripts/m11a/prune-staging.mjs --level all` → copy pinned Node `24.14.0` → copy the pinned Codex vendor runtime to `runtime/codex/`. No npm command ran after assembly.

Private node version: `v24.14.0`
System node required: **NO** for staged execution; the verification PATH contained only Windows system directories.
System npm required: **NO** for staged execution.
Runtime npm ci: **NO**.
Staging bytes: `1,115,085,114`
Files: `7,700`
Directories: `991`
M11-A `app/node_modules`: `652,879,404` bytes; `7,641` files; `973` directories.
Startup: MCP listTools cold start mean `895.79 ms`, median `755.01 ms`, min `740.18 ms`, max `1,755.13 ms`; the first process was the outlier.
MCP ready: `10` tools exposed; all four required tools present; final measured ready call `750.00 ms`.
Memory: MCP ready median Working Set `120,934,400` bytes and Private Bytes `159,834,112` bytes.
Codex preflight: **PASS**. `@openai/codex-win32-x64`, target `x86_64-pc-windows-msvc`, `codex.exe`, code-mode host, SDK client, and SDK thread probe all passed.
Direct smoke: **PASS**. HTTP 200, `DIRECT`, `SUCCESS`, 1 verified item.
Gemini smoke: **PASS**. HTTP 200, `GEMINI_D`, `SUCCESS`, 2 items, no fallback signal.
Luna smoke: **PASS structurally**. Real-user Windows context, HTTP 200, `LUNA_NATIVE`, honest `NO_RESULT`, 0 items, no Gemini fallback. This validates runtime/auth/MCP execution and does not claim a positive search hit.
Clean-machine result: **PASS for the available clean-context simulation**. Staged execution hid system Node/npm from `PATH`; the same Windows host was used, so no VM, second Windows profile, or second physical PC was available in this turn.
Korean/space path result: **PASS**. Fresh B1 assemblies under a space-containing path and a Korean-character path both returned HTTP 200 health, connected restricted MCP, and completed the direct query with `SUCCESS` and 1 verified item.

Result: **PASS**

## B2 Bundled host + private Node

Bundler/build-only tool: `esbuild` invoked through `npx`; not added to end-user dependencies or `package.json`.
Bundled modules: Case Finder-owned ESM host code from `src/server.js` into `app/case-finder.bundle.mjs`.
Externalized modules: all npm packages via `--packages=external`, including Codex SDK/platform, MCP SDK, `korean-law-mcp`, Gemini, and dotenv.
Asset policy: `public/` and `prompts/` remained external; `.env`, `logs/`, and `state/` remained mutable and external.
Private node retained: **YES**. B2 does not remove the private Node child-runtime requirement.
Staging bytes: `1,115,092,637`
Files: `7,674`
Directories: `990`
Startup: MCP listTools cold start mean `1,472.12 ms`, median `742.22 ms`, min `728.05 ms`, max `5,869.74 ms`; the first process was the outlier.
MCP ready: `10` tools exposed; all four required tools present; final measured ready call `742.22 ms`.
Memory: MCP ready median Working Set `120,504,320` bytes and Private Bytes `159,240,192` bytes.
Codex preflight: **PASS**.
Direct smoke: **PASS** on an isolated rerun; the first direct request was run concurrently with another smoke and hit one MCP timeout, then the sequential rerun returned HTTP 200, `DIRECT`, `SUCCESS`, 1 item.
Gemini smoke: **PASS**. HTTP 200, `GEMINI_D`, `SUCCESS`, 1 item, no fallback signal.
Luna smoke: **PASS structurally**. Real-user Windows context, HTTP 200, `LUNA_NATIVE`, `NO_RESULT`, 0 items, no fallback signal.
Clean-machine result: same sanitized private-Node execution context as B1; no system Node/npm requirement observed.

Special path hacks required: a separate bundle entrypoint plus retained `app/src/aoV2/` and `app/src/runtimeEnv.js` for the restricted MCP bridge.
Maintenance complexity: higher than B1 due build-only bundler reproducibility, a second entrypoint, retained bridge source, and external package/path rules.

Result: **REJECT**. The bundle reduced only 26 files and 1 directory while adding `7,523` bytes overall and leaving the entire `622.63 MiB` M11-A dependency tree and private Node/Codex layout intact. It provides no material operational benefit over B1.

## B3 SEA

Pinned Node SEA workflow: Node `v24.14.0` `--experimental-sea-config` preparation blob plus build-only `postject` injection. The temporary copied Node PE signature directory was removed before injection; the original Node executable was not modified. Code signing is outside M11-B.
SEA main build: **PASS for the minimal PoC**.
Embedded main format: CommonJS (`scripts/m11b/sea-main.cjs`).
`process.execPath`: the SEA executable path inside embedded main.
Child JS via `process.execPath`: **FAIL for true single-exe semantics**. The child invocation re-entered the embedded main and returned `role=embedded-main-reentered`, rather than executing `sea-child.cjs`.
Restricted MCP child result: not run after the first child stop-loss; the same re-entry violates the required MCP child-script contract.
Upstream `korean-law-mcp` child result: not run after the first child stop-loss; no architectural workaround was attempted.

### B3a SEA + private child Node

Private child Node retained: **YES**.
Required code/path abstraction: explicit child-node selection in the isolated PoC only; production source semantics were not changed to hide this requirement.
Staging bytes: not comparable; this was a minimal SEA PoC, not a Case Finder artifact.
Product smoke: not run; the candidate retains the second Node runtime and was not competitive with B1.
Material benefit over B1/B2: **NONE**. It still requires a normal Node interpreter for child JavaScript/MCP and adds SEA build/signing complexity.

Result: `TECHNICALLY_PASS_BUT_PRIVATE_NODE_RETAINED`; reject as a product layout.

### B3b true single EXE

Private node absent: **YES in the PoC**.
Restricted MCP: rejected at the child-process stop-loss.
Upstream MCP: not attempted after the same architectural failure.
Codex SDK: not attempted after the same architectural failure.
Direct: not attempted.
Gemini: not attempted.
Luna: not attempted.
Stop-loss triggered: SEA `process.execPath` re-entered the embedded main instead of running a requested child JavaScript file. Fixing this would require a second Node runtime, custom interpreter/launcher behavior, or MCP architecture changes.

Result: `SEA_TRUE_SINGLE_EXE_REJECT`.

## Runtime path audit

Developer absolute path dependency: **NO** in B1. Install and app roots are supplied through the managed runtime contract.
System Node dependency: **NO** at runtime; only build/test orchestration used the developer Node.
System npm dependency: **NO** at runtime; `npm ci` completed during assembly only.
Global MCP dependency: **NO**; `app/node_modules/korean-law-mcp` is used directly.
System Codex dependency: **NO**; managed `runtime/codex/` and the pinned SDK platform package are included.
WindowsApps dependency: **NO**.
`CODEX_CLI_PATH` dependency: **NO** for the product path; it remains a developer override only.
`process.cwd()` dependency: **NO** for B1 runtime paths; app/install roots are explicit.

## Artifact integrity

Manifest generated: `scripts/m11b/manifest.mjs`; B1 and B2 manifests were generated from immutable payloads while excluding `.env`, `logs/`, `state/`, and assembly metadata.

Critical file hashes (SHA-256):

| Artifact | SHA-256 |
|---|---|
| B1 `runtime/node/node.exe` | `63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088` |
| B1/B2 managed `codex.exe` | `935a1911ed2556e4ffcec995f4886ac2ac425863ba26fed264df62e30272ad9d` |
| B1/B2 code-mode host | `37c23a542037e1bcfd0fa7eb4a150c697229d7ff31bf675c519d5bff7226b191` |
| `korean-law-mcp/build/index.js` | `437ea5c59d342a15b2f378f809029f4932ad8800f1d51db06bdbc355002747f3` |
| M11-A prune procedure | `c1f189da346b78619705d84115f2a721b19561ba4371d627f66f225da95fc5c8` |
| B2 `case-finder.bundle.mjs` | `68fdf6033c9bd1768a4f26d740cd8b77050f7e519e192d24ef8e2b6bdbdc7233` |

Mutable paths separated: `.env`, `logs/`, and `state/`; user Codex authentication is not copied into the artifact.

## Security regression

127.0.0.1: **PASS**; staged product server bound locally.
Host/origin: existing runtime-hardening tests pass; foreign local Host/Origin requests remain rejected.
Secret exposure: **PASS**; Codex child environment excludes Case Finder secrets and restricted upstream receives only `LAW_OC`.
Silent fallback: **PASS**; direct/Gemini/Luna smoke summaries showed no fallback signal, and Luna failures remain Luna failures.

## M11-A purge preserved

Prune procedure unchanged: **YES**; `scripts/m11a/prune-staging.mjs` SHA recorded above.
Protected root `pdfjs` retained: **YES**; root `pdfjs-dist` remained in both candidates.
Codex platform package retained: **YES**; SDK/platform package and both managed native binaries remained available.
Removed OCR/ML/document scope accidentally used: **NO**; all required four-tool/listTools/legal search-detail paths passed without the removed optional ML/native/document subtrees.

## Candidate comparison

| metric | B1 | B2 | B3a | B3b |
|---|---:|---:|---:|---:|
| bytes | 1,115,085,114 | 1,115,092,637 | not comparable | not comparable |
| files | 7,700 | 7,674 | PoC only | PoC only |
| dirs | 991 | 990 | PoC only | PoC only |
| startup median | 755.01 ms | 742.22 ms | not measured | not measured |
| system Node | NO | NO | NO | NO |
| private Node | YES | YES | YES | NO |
| maintenance | low | high | high | unacceptable |
| product PASS | YES | REJECT | no | no |

## Final decision

Decision: **`B1_PRIVATE_NODE_ADOPT`**

Reason: B1 is the smallest reliable layout that preserves `process.execPath == runtime/node/node.exe`, lets the product run without system Node/npm/Codex, preserves the M11-A four-tool legal surface, passes the packaged Codex/MCP/direct/Gemini/Luna structural gates, and avoids new architecture. B2's small file-count reduction does not offset its path/build complexity. B3 cannot satisfy the child JavaScript/MCP contract without retaining a private Node or rewriting the architecture.

Rejected alternatives:

- `B2_BUNDLED_HOST_PRIVATE_NODE`: measurable but immaterial file reduction; no byte reduction; extra entrypoint and retained bridge source.
- `B3a`: technically executable only by retaining a private child Node; no material benefit over B1.
- `B3b`: `SEA_TRUE_SINGLE_EXE_REJECT` after the explicit `process.execPath` child stop-loss.

Accepted runtime layout:

```text
%LOCALAPPDATA%\Fable\CaseFinder\
├─ app\
│  ├─ src\
│  ├─ public\
│  ├─ prompts\
│  ├─ node_modules\       # npm ci + accepted M11-A prune at build time
│  ├─ config.js
│  ├─ package.json
│  └─ package-lock.json
├─ runtime\
│  ├─ node\node.exe       # Node 24.14.0
│  └─ codex\               # pinned Codex 0.147.0 native runtime
├─ state\                  # mutable
├─ logs\                   # mutable
├─ .env                    # mutable, not copied from the developer
└─ start.bat
```

## M12 installer input

Install root: `%LOCALAPPDATA%\Fable\CaseFinder`
Immutable files: `app/src/`, `app/public/`, `app/prompts/`, `app/node_modules/`, `app/config.js`, `app/package.json`, `app/package-lock.json`, `runtime/node/`, `runtime/codex/`, `start.bat`, `.env.example`
Mutable files: `.env`, `logs/`, `state/`
Private runtimes: `runtime/node/node.exe` `24.14.0`; `runtime/codex/` Codex `0.147.0` target `x86_64-pc-windows-msvc`
Prune step: run `npm ci` in the build environment, then apply `scripts/m11a/prune-staging.mjs`; never run npm on the target machine.
Launcher entry: `start.bat`, launching `runtime/node/node.exe app/src/server.js`.
Preflight: `runtime/node/node.exe app/src/verifyManagedRuntime.js --install-root <install-root> --skip-query`, followed by one authenticated Luna `/ask` smoke when the user has completed login.
Uninstall considerations: do not delete `.env`, `logs/`, or `state/` without an explicit user-data policy; preserve or back up user authentication/state according to the installer decision.
Signing considerations: no final installer or signed executable was produced in M11-B. The SEA PoC required temporary PE signature removal for injection; code signing and SmartScreen policy remain M12 work.

Ready for M12 installer: **YES**
