# Case Finder Architecture

## 1. Purpose and scope

Case Finder is a Windows application that searches Korean legal precedents by
natural-language question or case number. The product path is intentionally
small: the two supported search adapters are `gemini_d` and `luna_native`.

This document describes logical responsibilities and contracts. It does not
serve as a complete source-file inventory; source locations below are anchors
for the current implementation.

## 2. System overview

```text
User query
    │
    ├── case-number classification ──> Direct route
    │                                  │
    │                                  └─> legal provider lookup
    │
    └── natural-language classification
          │
          ├── Gemini D adapter
          │       └─> Gemini planning/selection + legal MCP
          │
          └── Luna Native adapter
                  └─> Codex app-server
                          └─> restricted legal MCP tools

Both routes
    → provider evidence
    → verified candidates
    → final selection gate
    → canonical result contract
    → HTTP/SSE response
```

The server boundary is implemented by `src/server.js` and `src/httpApi.js`.
Routing is isolated in `src/router.js`; adapter construction is centralized in
`src/searchAdapters/registry.js` and `src/searchAdapters/catalog.js`.

## 3. Request lifecycle

1. The HTTP layer validates the request and classifies it with `routeQuery`.
2. A single supported adapter handles either the direct or natural-language
   route.
3. Search results are parsed and bound to provider identity.
4. The evidence ledger records search, detail, and verification traces.
5. Only provider-verified candidates remain eligible for final output.
6. The selection gate applies the output and narrative integrity rules.
7. `toResultContract` normalizes adapter output into the public server result.
8. The renderer and SSE progress path expose only the safe product state.

Search discovery and evidence verification are separate responsibilities. An
LLM suggestion or a provider search hit is not, by itself, a verified case.

## 4. Search paths

### 4.1 Direct route

`src/router.js` recognizes supported case-number forms. A single valid case
identifier without related-search or exclusion intent uses the direct route.
The direct path queries the legal provider, validates the returned identity,
and preserves compound case identity when the provider returns one.

Multiple identifiers, unsupported case-like text, or requests for related or
alternative cases remain natural-language searches rather than being forced
into direct lookup.

### 4.2 Gemini D

The `gemini_d` adapter runs the deterministic natural-language pipeline in
`src/nlPipeline.js` through `src/geminiRuntime.js`.

- Provider: Gemini
- Model pin: `gemini-3.5-flash-lite`
- Role: fast natural-language precedent discovery and selection
- Verification source: Korean legal provider through `korean-law-mcp`
- Output rule: only verified provider cases may be returned

The product path contains the current planner/selection flow only. Diagnostic
and refined-search experiments are not part of the production adapter.

### 4.3 Luna Native

The `luna_native` adapter runs AO-v2 through a persistent Codex app-server.
Each query uses a fresh session context while the app-server process is reused
for its runtime lifetime.

- Runtime: Codex app-server `0.147.0`
- Transport: stdio app-server with dynamic tools
- Reasoning effort: `medium`
- Free/Go plan: requested model `gpt-5.6-terra`
- Other or unknown plan: requested model `gpt-5.6-luna`
- Failure behavior: no silent fallback to Gemini

The AO-v2 legal tool surface is deliberately restricted to:

- `search_decisions`
- `get_decision_text`
- `search_law`
- `get_law_text`

Shell, browser, web search, repository access, and unrelated tools are not
part of this product route.

## 5. Legal data and evidence layers

The legal data boundary is the Korean legal provider accessed through
`korean-law-mcp`. The following concepts must remain distinct:

```text
LLM/provider suggestion
    ≠ verified precedent

provider identity
    → a case identity returned by the legal provider

verified evidence
    → provider-observed identity plus successfully opened/validated detail

selected case
    → a verified case that passes final relevance and output checks
```

`src/aoV2/evidenceLedger.js` is the evidence authority for AO-v2. It retains
search and detail traces, provider-bound identity, and verification state.
`src/aoV2/finalSelectionGate.js` is the final output boundary. The equivalent
natural-language validation boundary remains in `src/validator.js` and the
pipeline finalization path.

Verification is monotonic for already established provider evidence: a later
failed re-fetch must not turn previously verified evidence into an invented or
silently substituted case. Unverified candidates are never used to fill an
output quota.

## 6. Selection and response contract

The adapters return the canonical contract from
`src/searchAdapters/resultContract.js` (`m9-result-contract-v1`). It carries
adapter/provider metadata, verified items, law references, validation details,
execution metadata, and the terminal state.

The main terminal states are:

| State | Meaning |
| --- | --- |
| `SUCCESS` | At least one verified result is available. |
| `PARTIAL_VERIFIED` | Some requested evidence failed validation, but verified items remain. |
| `NO_RESULT` | Search completed without a displayable verified result. |
| `SEARCH_FAILED` | Search or provider/detail verification failed before a safe result could be produced. |
| `SAFETY_REJECTED` | The output contract or integrity gate rejected the result. |

`NO_RESULT` is not permission to fabricate, substitute, or force-fill a case.
`SEARCH_FAILED` is kept separate so provider, MCP, authentication, and runtime
failures are not presented as an empty legal search.

## 7. Codex app-server, MCP, and lifecycle

`src/codexAppServerRuntime.js` owns the app-server process and shared runtime
lifecycle. `src/codexAppServerSession.js` owns a query session, tool-call
responses, finalization, timeout, and usage handoff. The runtime resolves the
packaged Codex executable through `src/codexRuntimeResolver.js` and verifies
the required app-server capabilities.

`src/aoV2/legalToolGateway.js` validates the restricted tool arguments,
classifies legal MCP results, records the search/detail trace, and writes
observations to the evidence ledger. Legal sentinel results such as
`NOT_FOUND`, provider errors, and invalid payloads retain different meanings.

## 8. Authentication and local state isolation

Case Finder Codex authentication is product-owned and is not shared with a
user-global Codex installation:

```text
Case Finder install root
└── state/
    ├── codex-home/       dedicated Codex auth/configuration
    └── codex-runtime/    session work area
```

`src/codexAuthIsolation.js` rejects a missing, unsafe, symbolic-link, or
global-overlapping dedicated home. The runtime passes the dedicated home to
the app-server and verifies that the effective credential store is file-based.
Secrets and raw authentication data are not part of the browser-facing API.

Other local state includes `.env` for settings and `logs/` for runtime logs.
The resolved paths are centralized in `src/runtimePaths.js`; see
`DEVELOPMENT.md` and `PACKAGING.md` for operational details.

## 9. Errors and termination

The product keeps these failure classes separate:

- invalid user input or unsupported adapter configuration;
- legal provider/MCP errors and definitive not-found results;
- Codex authentication, app-server, protocol, and timeout errors;
- Gemini request, quota, or response validation errors;
- integrity rejection of unverified or malformed output.

The HTTP layer maps these internal categories to safe user-facing messages.
Detailed auth data, provider payloads, prompts, private reasoning, and raw
tokens must not cross the public response boundary.

## 10. Configuration and frozen design rules

Product configuration is centralized in `config.js`. Important defaults are:

- port `3300`;
- `luna_native` as the default adapter;
- search display and candidate maximum `20`;
- maximum final results `5`;
- MCP timeout `30` seconds;
- Gemini request budget `2`.

The following are product invariants, not tuning suggestions:

- adapters remain `gemini_d` and `luna_native`;
- verified-only output, `EvidenceLedger`, and `FinalSelectionGate` remain in
  the path;
- the restricted four-tool legal surface remains unchanged;
- Luna failures never silently fall back to Gemini;
- prompts, model pins, ranking, and request budgets require explicit approval
  before change;
- auth isolation and secret redaction remain mandatory.

