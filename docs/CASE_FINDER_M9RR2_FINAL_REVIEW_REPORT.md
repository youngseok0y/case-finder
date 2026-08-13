# Case Finder M9RR2 Final Review Report

## 기준

- Base: `c0fab1b686f4858d1ece59fcb835644b4fb673be` (`main`)
- Implementation branch: `m9rr2-final-review-fixes`
- Implementation SHA: `7707b392a558797eaea5996e598635169494acb8`
- Scope: `CASE_FINDER_HANDOFF_M9RR2_FINAL_REVIEW_FIXES.md`의 Claude 최종 리뷰 결함만 수정
- 검색 구성: `gemini_d`와 `luna_native` 유지

## Findings 처리

| 우선순위 | 항목 | 처리 |
|---|---|---|
| P0 | Luna query 누락 | adapter 입력 query를 canonical source로 강제하고 정상·안전 거부 회귀 테스트 추가 |
| P0 | 검증 전부 실패 시 `NO_RESULT` 오분류 | `SEARCH_FAILED`로 분리하고 일반 empty-result 문구와 구분 |
| P0 | restricted MCP env 격리 | pure runtime env helper, dotenv 격리, upstream에는 최소 runtime env와 `LAW_OC`만 전달 |
| P1 | Luna 탐색 법령 노출 | ledger 탐색-only 법령을 product `lawReferences`와 item law references에서 제외 |
| P1 | `firstArray` 방어적 복사 | provider 배열을 shallow copy하도록 수정 |
| P2 | 법령 링크 중복 helper | `directLookup.lawDetailLink`를 단일 source로 사용 |
| P2 | 안전 거부 문구 중복 | `src/productMessages.js` shared constant로 통일 |
| P2 | direct service envelope | direct 응답에도 `service: "case-finder"` 추가 |
| P2 | Node version echo | batch redirection escape 수정 |
| P2 | stale/hung launcher UX | PID·image 표시, `/health` 미확인 시 수동 종료 안내, foreign process 자동 종료 금지 유지 |

## 변경 파일

- `config.js`
- `package.json`
- `start.bat`
- `src/aoV2/restrictedMcp/stdioServer.js`
- `src/productMessages.js`
- `src/runtimeEnv.js`
- `src/renderer.js`
- `src/searchAdapters/lunaNativeAdapter.js`
- `src/searchAdapters/resultContract.js`
- `src/server.js`
- `src/validator.js`
- `test/productNaturalIntegration.test.js`
- `test/runtimeHardening.test.js`
- `test/searchAdapters.test.js`

## 자동 QA

- `npm run check`: PASS
- `npm run product:test`: PASS, 38/38
- `npm run verify`: PASS
- `git diff --check`: PASS

## 실행·브라우저 QA

- `/health`: `service=case-finder`, Node `v24.14.0` 확인
- direct HTTP smoke: `service=case-finder`, `route=direct`, `stage=DIRECT`, verified item 1건 확인
- Gemini D HTTP smoke: 자연어 2건의 query 보존, `service=case-finder`, `stage=GEMINI_D`, `SUCCESS` 확인
- in-app Browser direct UI smoke: 사용자 질문, 법령 원문, 판례 원문, 공식 링크 표시 확인
- in-app Browser Gemini D UI smoke: 사용자 질문, 관련법규, verified 판례 카드 표시 확인
- Browser console error/warning: 0건

## 미완료·보류

- Luna Native HTTP/browser smoke: 현재 환경에서 Codex CLI 실행이 `spawn EPERM` 및 액세스 거부로 실패해 500 응답. 제품의 Gemini silent fallback은 발생하지 않음.
- Luna runtime 권한 문제는 Handoff 범위의 검색·prompt·tool·reasoning 수정 대상이 아니므로 코드 변경하지 않음.
- Browser network response의 secret 비노출 별도 검증은 미수행.
- 법제처 transport/curl/TLS 문제는 Handoff 지시대로 조사·수정하지 않음.

## 현재 상태

코드·자동 QA·direct/Gemini 브라우저 검증은 완료했습니다. 전체 terminal은 Luna Native 실행 권한 문제로 `M9RR2_FINAL_REVIEW_PENDING_LUNA_RUNTIME` 상태이며, Codex CLI 실행이 가능한 환경에서 Luna 2건 smoke를 재실행해야 최종 `M9RR2_FINAL_REVIEW_PASS`로 올릴 수 있습니다.
