# Case Finder — korean-law-mcp 4.12.1 Security Refresh

## Baseline and final revision

- Baseline branch: `fix/user-facing-search-copy`
- Baseline commit: `465e3778a21540de13308e6648648def91126cb4`
- Baseline working-tree note: an existing uncommitted `package-lock.json` audit-fix change was preserved.
- Final branch: `fix/korean-law-mcp-4.12.1-security`
- Final implementation commit: `c0ea648`

## Dependency result

| package | previous observed | final resolved | reason |
| --- | ---: | ---: | --- |
| `korean-law-mcp` | 4.9.6 | 4.12.1 | exact security/runtime refresh |
| `kordoc` | 4.7.2 / prior working-tree 4.9.2 | 4.9.2 | upstream dependency resolution |
| `adm-zip` | 0.5.18 path remained before override | 0.6.0 | security |
| `pdfjs-dist` | 5.7.284 | 4.10.38 | korean-law-mcp 4.12.1 contract |
| `sharp` | 0.34.5 path remained before override | 0.35.3 | security |
| `onnxruntime-node` | 1.27.0 / prior working-tree 1.29.0 | 1.29.0 | dependency provenance/security |

`package.json` pins `korean-law-mcp` exactly to `4.12.1`. Root overrides were necessary because the Case Finder tree initially retained `onnxruntime-node@1.24.3 → adm-zip@0.5.18` and `sharp@0.34.5` below `@huggingface/transformers`:

```json
{
  "onnxruntime-node": "^1.27.0",
  "sharp": "^0.35.3"
}
```

No direct `adm-zip` override was added; upgrading the parent runtime resolves `adm-zip@0.6.0` without forcing an incompatible major version into the old parent range.

## Audit

- Before target upgrade: full audit reported 7 high findings.
- Plain `korean-law-mcp@4.12.1` clean install: 6 high findings remained (`adm-zip` and `sharp` paths).
- Final production audit: `npm audit --omit=dev --audit-level=high` → `found 0 vulnerabilities`.
- Final counts: critical 0, high 0, moderate 0, low 0.
- `npm audit fix --force`: not run.

Clean-install sequence succeeded twice after dependency changes:

```text
remove node_modules → npm ci → audit
```

## Runtime parity

- MCP process started successfully and listed 10 upstream tools.
- Existing Case Finder gateway remained restricted to exactly:
  `search_decisions`, `get_decision_text`, `search_law`, `get_law_text`.
- Decision search: PASS; observed `2023두54914`.
- Decision detail: PASS; provider identity matched and detail verified.
- Law search: PASS; observed `민법`, `lawId=001706`, `mst=284415`.
- Law detail: PASS through `lawId`; law enrichment and ledger verification succeeded.
- Compatibility fix: current 4.12.1 provider returned an external API error for `mst=284415`, while the same observed `lawId=001706` succeeded. Existing enrichment now prefers the observed `lawId` and retains `mst` for links.

Direct-route regression:

- `99두2963`: `DIRECT` route, two-digit identity preserved, provider detail verified (`대법원`, `20000411`).
- Existing modern, two-digit, compound, and identity-safety fixtures passed in the full suite.

## Adapter regression

- Deterministic Gemini regression: PASS, existing behavior unchanged.
- Gemini live smoke: 3/3 successful natural queries; all had `outputValid=true` and verified items only.
- Luna deterministic/runtime/auth-isolation tests: PASS.
- Luna live smoke: not run because dedicated `state/codex-home` reported `loggedIn=false`, `requiresOpenaiAuth=true`; no global auth was used.
- Managed runtime check: blocked because this source checkout has no `runtime/node/node.exe`; installer construction was outside this milestone.

## Packaging prune

The clean Windows tree was copied to a temporary staging directory and pruned successfully. The stale nested `kordoc/node_modules/pdfjs-dist` path and absent platform-only `@img/sharp-wasm32` target were removed from the prune manifest. The final staging inventory retained only safe `pdfjs-dist@4.10.38`; known vulnerable `adm-zip`, `sharp`, `onnxruntime-node`, and `@huggingface/transformers` manifests were absent after prune.

## Verification

- `npm run check`: PASS — 77 JavaScript/module files.
- `npm test`: PASS — 128/128.
- `npm run verify`: PASS — 128/128.
- `npm audit --omit=dev --audit-level=high`: PASS — 0 vulnerabilities.
- `git diff --check`: PASS.
- `npm run verify:managed -- --skip-query`: BLOCKED — managed Node runtime missing in source checkout.

## Remaining risks and recommendation

The only unexecuted live path is Luna, because the dedicated product-owned Codex namespace is logged out. Managed-runtime packaging verification also requires the separately provisioned private Node runtime. No Gemini/Luna prompt, model, ranking, tool surface, auth isolation, or evidence-integrity policy was changed.

KOREAN_LAW_MCP_4_12_1_SECURITY_PASS
