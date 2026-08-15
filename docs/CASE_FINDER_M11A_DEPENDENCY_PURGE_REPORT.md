# Case Finder M11-A Dependency Purge Parity Report

## 1. Dependency provenance

- Repository: `youngseok0y/case-finder`
- Working branch: `m11-a-dependency-purge`
- M11-0 source baseline used for A0/A1: `8980997ee10c3f12d9789a4d69ef4ee6b36e17e5`
- `milestone/m11-0-hardening` peels to `8980997`; the implementation commit recorded by the M11-0 handoff is `b7ef763`, followed by the report-only commit at `8980997`.
- Node: `v24.14.0`; npm: `11.12.1`; OS: Windows 10.0.19045 x64; CPU: 12 logical processors.
- A0 and A1 used the same tracked source, `package.json`, `package-lock.json`, Node/npm, OS, environment, `LAW_OC`, queries, and measurement harness inputs.
- A0 and A1 were each created with normal `npm ci`. `npm ci --omit=optional` was not used.

Initial `npm explain` and manifest inspection produced this classification:

| Package/copy | Version | Relation | Classification | A0 size |
|---|---:|---|---|---:|
| `@huggingface/transformers` | 4.2.0 | optional from `kordoc` | P1 candidate; contains nested ML/ONNX/sharp subtree | 239.46 MiB |
| `@hyzyla/pdfium` | 2.1.13 | optional from `kordoc` | P1 candidate; native/wasm PDF subtree | 10.73 MiB |
| `onnxruntime-node` root | 1.27.0 | optional from `kordoc` | P1 candidate; distinct root copy | 258.28 MiB |
| `onnxruntime-node` nested | 1.24.3 | dependency of `transformers` | removed with transformer subtree | 210.14 MiB |
| `pdfjs-dist` root | 5.7.284 | direct dependency of `korean-law-mcp` | P0 protected | 33.66 MiB |
| `pdfjs-dist` nested | 4.10.38 | optional from `kordoc` | P1 candidate; document-parser copy | 35.62 MiB |
| `sharp` root | 0.35.3 | optional from `kordoc` | P1 candidate; root optional copy | 0.91 MiB |
| `sharp` nested | 0.34.5 | dependency of `transformers` | removed with transformer subtree | 0.51 MiB |

Protected runtime and legal surface packages were retained: `@openai/codex-sdk@0.147.0`, the Windows `@openai/codex-win32-x64@0.147.0-win32-x64` package and both packaged binaries, `@modelcontextprotocol/sdk@1.30.0`, `korean-law-mcp@4.9.6`, `kordoc@4.7.2` core, and the root direct `pdfjs-dist@5.7.284` copy. The four production MCP tools remain `search_decisions`, `get_decision_text`, `search_law`, and `get_law_text`.

Static import inspection showed that the optional ML/OCR/PDFium/sharp paths are lazy document/OCR paths; they are not loaded while the MCP server starts and lists tools. This does not claim that removed packages continue to support document parsing, annex parsing, OCR, or image rendering.

## 2. A0/A1 footprint

| Tree | A0 bytes | A0 MiB | A0 files/dirs/native | A1 bytes | A1 MiB | A1 files/dirs/native |
|---|---:|---:|---|---:|---:|---|
| `node_modules` | 1,252,698,616 | 1,194.67 | 9,868 / 1,518 / 48 | 652,879,404 | 622.63 | 7,641 / 973 / 14 |
| `korean-law-mcp` | 1,077,184 | 1.03 | 216 / 5 / 0 | 1,077,184 | 1.03 | 216 / 5 / 0 |
| `kordoc` | 53,012,358 | 50.56 | 1,108 / 52 / 0 | 15,662,333 | 14.93 | 753 / 33 / 0 |
| root `pdfjs-dist` | 35,291,687 | 33.66 | 493 / 20 / 4 | 35,291,687 | 33.66 | 493 / 20 / 4 |

Final A1 reduction: **599,819,212 bytes / 572.03 MiB / 47.88% of `node_modules`**, with 2,227 fewer files, 545 fewer directories, and 34 fewer native files.

The exact staging-copy removal groups were:

| Removal group | Bytes | MiB |
|---|---:|---:|
| `node_modules/@huggingface/transformers` | 251,095,162 | 239.46 |
| `node_modules/@hyzyla/pdfium` | 11,246,019 | 10.73 |
| `node_modules/onnxruntime-node` | 270,827,297 | 258.28 |
| `node_modules/kordoc/node_modules/pdfjs-dist` | 37,350,025 | 35.62 |
| `node_modules/sharp` | 958,466 | 0.91 |
| exact root sharp payloads: `@img/colour`, `@img/sharp-wasm32`, `@img/sharp-win32-x64` | 28,342,243 | 27.03 |
| **Total** | **599,819,212** | **572.03** |

The A1 staging `package-lock.json` SHA-256 matched A0 and the repository lockfile. No package manifest or lockfile was rewritten.

## 3. Cold start

Measurement is process spawn through MCP initialize/connect/listTools. Seven processes were measured per arm.

| Arm | Mean | Median | Min | Max |
|---|---:|---:|---:|---:|
| A0 | 1,738.61 ms | 771.77 ms | 754.01 ms | 7,265.59 ms |
| A1 | 802.96 ms | 789.74 ms | 745.47 ms | 878.37 ms |

The A0 maximum was the first process on this machine; repeated-process measurements are affected by Windows/Node filesystem cache state. A1 showed no observed startup regression in this run, but this is not a causal performance claim.

## 4. Ready memory

Samples were taken after connect/listTools and before a legal tool call, using Windows Working Set and Private Bytes.

| Arm | Working Set median/range | Private Bytes median/range |
|---|---|---|
| A0 | 120.45 MiB / 120.45–120.45 MiB | 151.50 MiB / 151.50–151.50 MiB |
| A1 | 120.59 MiB / 120.59–120.59 MiB | 152.05 MiB / 152.05–152.05 MiB |

The observed A1 deltas were approximately +0.14 MiB Working Set and +0.55 MiB Private Bytes, within this run's sampling noise; no material memory regression was observed.

## 5. Four-tool listTools gate

A0 and every progressive A1 purge level exposed 10 tools, including all four required production tools:

- `search_decisions`: present
- `get_decision_text`: present
- `search_law`: present
- `get_law_text`: present

No MCP startup, initialize, connect, or listTools load error occurred after any tested purge step.

## 6. Semantic parity

The same serial provider calls were made against A0 and A1 with the same `LAW_OC` and inputs. Raw provider text and URLs were not stored.

| Contract path | Query | A0 | A1 | A0/A1 text length |
|---|---|---|---|---:|
| `search_decisions` | `domain=precedent`, `99두2963`, `display=1` | success; observed ID | success; observed ID | 308 / 308 |
| `get_decision_text` | observed decision ID, `full=false` | valid non-`NOT_FOUND` text | valid non-`NOT_FOUND` text | 2,303 / 2,303 |
| `search_law` | `민법`, `display=1` | success; observed MST | success; observed MST | 299 / 299 |
| `get_law_text` | observed MST | valid non-`NOT_FOUND` text | valid non-`NOT_FOUND` text | 956 / 956 |

The result is parity of the tested legal contract paths, not a claim that removed `kordoc` document/OCR capabilities remain available.

## 7. Packaged Codex runtime gate

Both A0 and A1 passed `inspectPackagedCodexRuntime()` with:

- `@openai/codex-win32-x64`
- target `x86_64-pc-windows-msvc`
- packaged `codex.exe`: present
- packaged `codex-code-mode-host.exe`: present
- SDK client/thread probe: pass

The A1 test did not require PATH, `CODEX_CLI_PATH`, WindowsApps, or a manually installed external Codex executable.

## 8. Regression

- `npm run verify`: **76 passed, 0 failed, 0 skipped**.
- New M11-A harness files passed `node --check`.
- `git diff --check`: pass.
- Literal token-like secret scan of new scripts: pass.
- No source behavior, prompt, model, reasoning, budget, query/ranking, candidate limit, preview limit, concurrency, LegalToolGateway, EvidenceLedger, FinalSelectionGate, restricted MCP, Host/origin, or adapter pinning change was made.

The post-prune `npm ls --all` diagnostic reports extraneous transitive directories because A1 is an intentionally package-manager-independent staging copy and the lockfile was deliberately not rewritten. This diagnostic was not treated as a runtime pass; load, listTools, Codex, legal parity, and product gates above are the acceptance evidence. The prune script removes only the allowlisted exact directories and fails on path escape or an unexpected missing target.

## 9. Product smoke

Executed against the final A1 staging copy with provider values passed in memory from the existing local `.env`; no secret value was emitted or saved.

| Smoke | Result |
|---|---|
| Direct `99두2963` | `DIRECT`, HTTP 200, `SUCCESS`, 1 verified item |
| Gemini natural `계약 해지 손해배상` | `GEMINI_D`, HTTP 200, `SUCCESS`, 2 items, fallback label absent |
| Luna natural `계약 해지 손해배상` | `LUNA_NATIVE`, HTTP 200, `NO_RESULT`, 0 items, fallback label absent |

The Luna smoke was rerun in the real user's Windows context after the sandbox-only Codex temp-directory permission failure was isolated. The authenticated native path completed with HTTP 200 and an honest `NO_RESULT`; no Gemini fallback occurred. This confirms the packaged/runtime and authentication path, but it is not a positive-hit or search-quality claim.

## 10. Frozen invariants

The following remained frozen throughout M11-A:

- package versions, Node range, npm mode, and `package-lock.json`;
- `gemini_d` and `luna_native` product adapters;
- Gemini and Luna model/reasoning pins;
- fixed prompts, selection/ranking/query behavior, result limits, and concurrency;
- `korean-law-mcp` version and the four legal tool contracts;
- restricted legal MCP, EvidenceLedger, FinalSelectionGate, verified-only output, and M11-0 timeout behavior;
- packaged Codex SDK/platform runtime and Windows-only runtime resolution;
- source files outside the new M11-A measurement/prune harness.

## 11. Decision

**`PURGE_ADOPT` for the M11-A deployable four-tool/runtime scope.**

The selective A1 staging purge removed the isolated optional ML/native/document subtrees and achieved a 47.88% node_modules reduction while preserving startup/listTools, the four legal search/detail contracts, observed-ID detail verification, packaged Codex runtime, Gemini and Luna product smoke without silent fallback, and the full 76-test regression suite.

This decision adopts staging-copy pruning only. It does not authorize changing `package.json`/`package-lock.json`, globally omitting optional dependencies, forking `korean-law-mcp`/`kordoc`, or claiming non-production `kordoc` document/OCR/annex/render features are supported after purge.

## 12. M11-B handoff input

M11-B should consume:

1. the allowlisted staging prune procedure in `scripts/m11a/prune-staging.mjs`;
2. the A0/A1 measurement and parity harnesses in `scripts/m11a/`;
3. the protected package list and the root-direct `pdfjs-dist` exception above;
4. the final A1 footprint of 622.63 MiB for the measured `node_modules` staging tree;
5. a clean installer/package assembly test on the intended deployment artifact, including a second clean Windows environment if available;
6. the authenticated Luna natural smoke recorded above (`HTTP 200`, `NO_RESULT`, no fallback); this is runtime/readiness evidence, not a search-quality result.

M11-B must re-check whether annex/document/OCR tooling is in the actual deployable scope. If it is, this M11-A decision must be narrowed or reverted for those paths rather than silently restoring or changing the dependency contract.
