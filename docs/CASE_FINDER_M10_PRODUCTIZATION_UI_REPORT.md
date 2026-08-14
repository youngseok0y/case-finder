# Case Finder M10 Productization UI Report

## Final terminal

`M10_PRODUCTIZATION_UI_BLOCKED`

M10 UI/productization 구현과 주요 browser QA는 완료했지만, handoff의 시작 조건인 M9RR3 commit이 아직 존재하지 않아 Base SHA를 기록할 수 없습니다. 따라서 최종 commit 전의 working tree를 M10 PASS로 표시하지 않습니다.

## Base / final

- Base SHA: not recorded; M9RR3 변경이 uncommitted working tree에 있음
- Final SHA: not recorded; 이번 작업도 commit하지 않음
- 마지막 committed ancestor: `4909e07871bf7d6d898255bf3d88d325f4a40c0c`

## Scope and invariants

- 검색 알고리즘, Gemini D prompt/ranking/selector, Luna prompt/policy/tool surface, reasoning effort, EvidenceLedger, FinalSelectionGate: 변경하지 않음
- `gemini_d`와 `luna_native`만 UI에 노출
- Luna 실패 시 Gemini silent fallback 없음
- private reasoning, raw tool arguments, generated search plan, secret: UI·SSE progress·admin GET에 노출하지 않음
- 기존 `POST /ask` JSON contract 유지

## Implemented files and architecture

- `public/index.html`: semantic main search shell, status, accessible form, progress and result containers
- `public/styles.css`: responsive 360px/768px/desktop layout, focus state, disabled/loading state, status distinction, cards and native details styling
- `public/app.js`: `/ask/stream` SSE consumer, 1-second loading threshold, duplicate-submit prevention, monotonic stage display, final/error rendering, `/health` status display
- `public/admin.html`, `public/admin.js`: local whitelist settings UI; secrets are write-only
- `src/server.js`: static assets, `/ask/stream`, `/status`, `/admin/config`, same-origin admin write, status/quota payload, terminal-state error payloads
- `src/progress.js`: allowlisted host-stage progress events and monotonic stage mapping
- `src/adminConfig.js`: whitelist validation, atomic `.env` write, secret-safe settings view
- `src/renderer.js`: verified-only cards, all verified items, provider-sourced law `<details>`, direct miss guidance, terminal-state rendering
- `src/validator.js`: all-provider-not-found direct lookup maps to `NO_RESULT`; verification failures remain `SEARCH_FAILED`
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

## Browser QA

- Main UI status: PASS; Luna managed page showed `Luna 고정밀 검색`, MCP connected, and graceful Luna quota-unavailable text.
- Direct miss: PASS; distinct 사건번호 조회 결과 없음 guidance and two official court-service links.
- Gemini natural query: PASS on separate Gemini D server; Gemini label, verified cards, provider law links/details, and no console error/warning were observed.
- Luna natural golden: PASS on temporary managed stable `0.147.0` fixture; progress appeared after 1 second and final UI showed 완료 state, Luna label, and 3 verified cards with provider detail text.
- Responsive: PASS for main page at 360px and 768px with no horizontal overflow; desktop DOM layout also loaded.
- Temporary managed Codex fixture, copied auth file, and QA servers: removed after testing.

## Remaining blocker / follow-up

1. Create the required M9RR3 PASS commit and record its exact SHA as M10 Base SHA.
2. Run one direct-success browser case, one mobile `/admin` interaction check, and a separate Luna-tab console/network capture after the base commit.
3. Re-run `git diff --check`, `npm run verify`, and the stable Luna golden after the final commit.
4. Change the terminal to `M10_PRODUCTIZATION_UI_PASS` only after the above evidence is attached.

Installer construction remains out of scope for M10.
