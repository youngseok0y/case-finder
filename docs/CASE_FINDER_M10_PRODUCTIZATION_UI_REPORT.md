# Case Finder M10 Productization UI Report

## Final terminal

`M10_PRODUCTIZATION_UI_PASS`

M10 UI/productization 구현과 비Luna QA는 완료됐습니다. Luna/Codex runtime QA는 사용자의 지시에 따라 M10-R로 이관했으며, 이 보고서는 해당 검증을 PASS로 주장하지 않습니다. 모바일 UI와 mobile viewport QA는 로컬 PC 제품 범위에서 제외했습니다.

## Base / final

- Base SHA: `4909e07871bf7d6d898255bf3d88d325f4a40c0c` (M9RR2 마지막 committed ancestor; 공용 파일 분리를 위해 중간에 깨진 M9RR3 base commit을 만들지 않음)
- Final SHA: `72914a7db23028af8ec4187bf6c39908c4d96c96`
- Publish commit: `[M9RR3/M10] Publish managed runtime and product UI`

## Scope and invariants

- 검색 알고리즘, Gemini D prompt/ranking/selector, Luna prompt/policy/tool surface, reasoning effort, EvidenceLedger, FinalSelectionGate: 변경하지 않음
- `gemini_d`와 `luna_native`만 UI에 노출
- Luna 실패 시 Gemini silent fallback 없음
- private reasoning, raw tool arguments, generated search plan, secret: UI·SSE progress·admin GET에 노출하지 않음
- 기존 `POST /ask` JSON contract 유지

## Implemented files and architecture

- `public/index.html`: semantic main search shell, status, accessible form, progress and result containers
- `public/styles.css`: 기존 responsive layout을 유지하며 desktop/local PC UI, focus state, disabled/loading state, status distinction, cards and native details styling을 제공
- `public/app.js`: `/ask/stream` SSE consumer, 1-second loading threshold, duplicate-submit prevention, monotonic stage display, final/error rendering, `/health` status display
- `public/admin.html`, `public/admin.js`: local whitelist settings UI; secrets are write-only
- `src/server.js`: static assets, `/ask/stream`, `/status`, `/admin/config`, same-origin admin write, status/quota payload, terminal-state error payloads
- `src/progress.js`: allowlisted host-stage progress events and monotonic stage mapping
- `src/adminConfig.js`: whitelist validation, atomic `.env` write, secret-safe settings view
- `src/renderer.js`: verified-only cards, all verified items, provider-sourced law `<details>`, direct miss guidance, terminal-state rendering
- `src/validator.js`: all-provider-not-found direct lookup maps to `NO_RESULT`; verification failures remain `SEARCH_FAILED`
- `src/directLookup.js`: upstream/API errors are kept as `SEARCH_FAILED` instead of being misreported as direct `NO_RESULT`
- `src/server.js`: Luna native session termination errors are classified as `LUNA_RUNTIME_UNAVAILABLE`
- `public/app.js`, `public/styles.css`: terminal-state-specific status-line wording and notice styling
- `src/aoV2/`, `src/nlPipeline.js`, adapter files: progress callback plumbing only; search behavior is unchanged
- `test/m10Productization.test.js`: progress monotonicity, admin secret safety/whitelist, renderer provenance, direct miss mapping

## HTTP and progress contract

`POST /ask` remains the backward-compatible JSON endpoint.

`POST /ask/stream` returns `text/event-stream` with allowlisted events:

```text
SEARCH_STARTED
ROUTE_IDENTIFIED
ANALYSIS_COMPLETE
LAW_EVIDENCE_UPDATED
CANDIDATES_FOUND
DETAIL_VERIFIED
FINALIZING
SEARCH_COMPLETE
SEARCH_FAILED
FINAL
```

Progress payloads contain only stage label, monotonic stage percentage, route, candidate count, verified count, and law count. The `FINAL` event contains the existing canonical response envelope and rendered result.

## Terminal-state mapping

| State | UI behavior |
|---|---|
| `SUCCESS` | verified result cards and provider law references |
| `NO_RESULT` | normal empty state; direct not-found adds court-service guidance |
| `SEARCH_FAILED` | source/detail verification failure message |
| `SAFETY_REJECTED` | safe-result blocking message without gate detail |
| `LUNA_RUNTIME_UNAVAILABLE` | Luna runtime installation/auth/runtime guidance; no Gemini fallback |
| `NETWORK_SERVER_ERROR` | transport/server failure message |

## Admin and quota

- GET `/admin/config` returns adapter selection, configured booleans, numeric settings, and restart-required state; it never returns `LAW_OC`, `GEMINI_API_KEY`, or auth values.
- POST `/admin/config` accepts only the declared whitelist, requires same-origin when `Origin` is present, and writes atomically.
- `CODEX_CLI_PATH` is not exposed in the product settings form; managed Codex remains canonical.
- Gemini usage is shown as `로컬 추정` from the existing local counter.
- Luna quota is shown as `Luna 사용량 확인 불가` when structured quota data is unavailable; quota status does not block search.

## Codex CLI diagnosis

- `CODEX_CLI_PATH` is configured as the `codex` alias, not an accessible executable path.
- The managed candidate `runtime\\codex\\bin\\codex.exe` and `codex-code-mode-host.exe` are absent in the current checkout.
- PATH resolves to the WindowsApps Codex executable, but `codex.exe --version` fails with Windows `액세스가 거부되었습니다`.
- Direct fix: place the pinned managed Codex CLI and code-mode host under `runtime\\codex\\bin`, or set `CODEX_CLI_PATH` to an accessible unpacked `codex.exe` whose sibling `codex-code-mode-host.exe` exists, then restart the server.
- The UI now gives this direct action for CLI missing, host missing, and version-check failures instead of only suggesting installation recovery.

## Automated QA

- `npm run check`: PASS
- `npm run product:test`: PASS, 51/51
- `npm run verify`: PASS, 51/51
- `git diff --check`: PASS for tracked changes; the new untracked report was reviewed separately
- `/ask` direct response compatibility: PASS; HTTP 200, service marker, `DIRECT`, direct `NO_RESULT`
- `/ask/stream` event order: PASS on direct route; `SEARCH_STARTED → ROUTE_IDENTIFIED → DETAIL_VERIFIED → FINALIZING → SEARCH_COMPLETE → FINAL`
- admin GET secret exposure: PASS; no secret values returned
- admin cross-origin write: PASS; HTTP 403
- renderer/progress/admin unit coverage: PASS

## Follow-up implementation run

The follow-up changes preserve the M9/M10 search configuration, provider contract, and verification gates.

- `npm run verify`: PASS, 52/52
- Direct query browser check: the provider returned an upstream `[EXTERNAL_API_ERROR] fetch failed` for the known case fixture. The result now renders `SEARCH_FAILED` with verification-failure wording rather than the direct not-found guidance.
- Direct-success browser QA: PASS on `gemini_d` with `2017다292343`; the page rendered `검색을 완료했습니다.`, the verified Supreme Court case, the official Law.go.kr detail link, 판시사항, and 판결요지.
- Direct-miss CTA browser QA: PASS; `2099다999999` rendered the no-result state and the two requested court portal URLs resolved as actual anchors.
- Terminal status line: PASS; the browser now distinguishes successful completion, normal no-result, verification failure, safety rejection, Luna unavailability, and transport/server failure.
- Admin interaction: PASS; whitelist form save completed, admin GET exposed no secret field/value, and cross-origin write returned HTTP 403.
- Browser console: PASS; the final Gemini D QA tab reported zero error/warning entries.
- Luna/Codex runtime QA: intentionally skipped per user instruction and deferred to M10-R.
- Mobile viewport override는 로컬 PC 제품 범위 밖이므로 M10 release gate에서 제외했다.

## Browser QA

- Main UI status: PASS; Gemini D local page showed the Gemini route label, 법령 API connected status, and normal search shell behavior.
- Direct miss: PASS; distinct 사건번호 조회 결과 없음 guidance and two requested court portal links: 판결서인터넷열람 and 판결서사본제공신청.
- Gemini natural query: PASS on separate Gemini D server; Gemini label, verified cards, provider law links/details, and no console error/warning were observed.
- Luna natural golden/runtime QA: SKIPPED by explicit scope; the Codex CLI/runtime issue is deferred to M10-R.
- Desktop/local PC layout: PASS; 기존 responsive CSS는 유지하며 mobile viewport QA는 수행 대상에서 제외했다.
- QA server: stopped after browser verification; no temporary Codex fixture or auth file was created in this run.

## M10-R deferral

- The historical CLI-path diagnosis above is superseded by the M10-R SDK boundary. The normal product path now uses the pinned `@openai/codex-sdk` package and its platform runtime; `CODEX_CLI_PATH`, WindowsApps discovery, and manual sibling-binary placement are not required.
- M10-R runtime evidence and the remaining quality caveat are recorded in `CASE_FINDER_M10R_CODEX_SDK_REPORT.md`.
- The M10-R change does not relax the Luna restricted-MCP, EvidenceLedger, FinalSelectionGate, or verified-only contracts.

Installer construction remains out of scope for M10.
