# Case Finder agent instructions

Read `README.md` before changing the project. The repository is the production clean slate; historical benchmark reports and handoffs are preserved outside the product tree.

## Frozen product invariants

- Product adapters are `gemini_d` and `luna_native` only.
- Search display is fixed at `20` and `candidateMax=20`.
- Do not change the Gemini plan/selection prompts, ranking, request budget, or model pin without explicit approval.
- Do not change Luna Native AO-v2 prompts, policy, reasoning, model pin, or restricted legal MCP surface without explicit approval.
- Preserve provider-only source fields, verified-only final cases, compound identity behavior, `EvidenceLedger`, and `FinalSelectionGate`.
- Luna failures must not silently fall back to Gemini.
- Do not expose secrets, private reasoning, system prompts, raw tool planning, or auth tokens.
- Do not add or change runtime dependencies without explicit approval.

## Scope and verification

Make the smallest correct change. Preserve unrelated user files and untracked private evaluation artifacts. Before delivery, report changed files, skipped work, QA performed, and remaining risks. Run `npm run verify` for code changes and `git diff --check` before committing.

Production code must remain network/model-free under the default test suite. Live law.go, Gemini, or Luna checks are optional and must be explicitly identified as live checks.
