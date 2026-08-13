# M8 Provider-Native AO-v2 Phase A Report

Date: 2026-08-13

Branch: `m8-provider-native-ao-v2`

Base: `69db8ca634bfaa0daaf79b916736c99558d8817c` (`m7-codex-luna-medium-eval`)

Checkpoint: `M8_GOLDEN17_DIAGNOSTIC_COMPLETE`

Next checkpoint: `M8_USER_REVIEW_REQUIRED`

## 1. 범위

M8 handoff에 따라 기존 `agenticPipeline.js`, `geminiRuntime.js`, `codexCliRuntime.js`와 D product path는 보존하고, AO-v2 Phase A 구조와 오프라인 계약 테스트만 추가했어요.

이번 단계에서 하지 않은 것:

- D 검색계획/ranking/selector 변경
- Gemini prompt/model/rate-limit 변경
- M6G/M6H 재개
- Codex unrestricted shell/web/repo 접근
- fresh golden 17 실행
- main 통합

## 2. 구현된 구조

공통 core:

- `src/aoV2/legalToolGateway.js`
  - 네 가지 legal tool whitelist
  - 빈 query 차단
  - precedent `options.search=2`
  - 판례 detail `full=false`
  - search-observed id/law identifier만 detail 허용
  - normalized legal result와 ledger 연결
- `src/aoV2/evidenceLedger.js`
  - 판례 candidate 관측/검색 query/provider id
  - detail opened/verified 상태
  - 법령 search/text evidence
  - selection attempt trace
- `src/aoV2/finalSelectionGate.js`
  - detail-verified evidence만 final eligible
  - verified + unverified 혼합 선택 시 verified만 보존
  - unverified 선택을 `MODEL_UNVERIFIED_SELECTION_ATTEMPT`로 기록
  - duplicate와 invalid match 제거
- `src/aoV2/telemetry.js`
  - provider-neutral AO-v2 telemetry schema
  - `output_valid`, `model_protocol_clean`, `selection_repaired` 분리 계측
- `src/aoV2/safety.js`
  - wall-clock, legal tool count, abort signal, no-progress watchdog
- `src/aoV2/restrictedMcp/server.js`
  - Luna restricted legal tool bridge

Provider-native adapter:

- `src/aoV2/providers/geminiNativeAo.js`
  - Gemini native `contents`/function-calling/function-response continuation을 adapter 내부에서만 유지
  - 공통 core에는 Gemini response object를 노출하지 않음
- `src/aoV2/providers/codexNativeAo.js`
  - 하나의 persistent session factory를 질문당 한 번만 생성
  - native tool-call/result continuation 계약 사용
  - 허용 legal tool 외 shell, command execution, web, browser, repo, GitHub 이벤트를 protocol invalid 처리
  - Gemini-shaped conversation replay/function-call envelope를 사용하지 않음
- `src/aoV2/index.js`
  - `runAgenticSearchV2(query, options)` top-level interface

## 3. 핵심 불변식

```text
SEARCH_OBSERVED -> DETAIL_ALLOWED
SEARCH_NOT_OBSERVED -> DETAIL_REJECTED
DETAIL_VERIFIED -> FINAL_ELIGIBLE
DETAIL_NOT_VERIFIED -> FINAL_INELIGIBLE
```

공통 gate는 모델의 semantic confidence가 evidence eligibility를 바꾸도록 허용하지 않아요. invalid extra는 안전하게 제거하지만, 함께 제출된 verified exact 결과까지 폐기하지 않아요.

출력 안전성과 모델 protocol 청정도는 별도로 집계해요.

```text
output_valid: host gate 이후 사용자 출력이 안전한가
model_protocol_clean: 모델 원본 selection이 host 수리 없이 계약을 지켰는가
selection_repaired: host gate가 selection/intro를 제거·수정했는가
```

예를 들어 verified A와 unverified B가 함께 제출되면 `output_valid=true`, `model_protocol_clean=false`, `selection_repaired=true`, `protocol_pass=false`가 됩니다. 따라서 host repair로 안전해진 결과를 모델 protocol 개선으로 잘못 세지 않아요.

또한 `createAgenticSearchV2().runAgenticSearchV2()`가 질문마다 새 `EvidenceLedger`, `LegalToolGateway`, `Telemetry`, `SafetyController`, provider session을 생성하도록 바꿨어요. gateway/adapter 옵션으로 전달된 ledger를 재사용하지 않으며, 각 ledger에는 별도 `scopeId`와 telemetry `question_scope_id`가 기록됩니다.

## 4. Phase A QA

통과:

- `npm run check`
- `npm run m8:test`: 13/13
- AO-v2 index import check: `M8_AO_V2_IMPORT_OK`
- `git diff --check`
- LegalToolGateway empty query 호출 0
- unobserved detail 차단
- observed detail 허용 및 `full=false`
- precedent `search=2`
- verified + unverified mixed final filtering
- verified + unverified mixed final의 `output_valid/model_protocol_clean/selection_repaired` 분리
- duplicate final dedupe
- Gemini native continuation fixture
- Luna single persistent session fixture
- Luna forbidden tool contamination fixture
- 질문 A/B 간 ledger 및 observed-id isolation fixture

기존 제품 verify:

- `npm run verify`는 실행했지만 11건이 모두 `fetch failed`로 종료됐어요.
- 원인은 이 worktree에서 제품 서버가 `127.0.0.1:3300`으로 실행 중이지 않았기 때문이에요.
- 이 실패는 AO-v2 오프라인 테스트 실패가 아니며, 서버를 임의로 띄워 live/MCP 호출을 추가하지 않았어요.

## 5. 변경 파일

- `package.json`
- `src/aoV2/index.js`
- `src/aoV2/evidenceLedger.js`
- `src/aoV2/finalSelectionGate.js`
- `src/aoV2/legalToolGateway.js`
- `src/aoV2/safety.js`
- `src/aoV2/telemetry.js`
- `src/aoV2/providers/geminiNativeAo.js`
- `src/aoV2/providers/codexNativeAo.js`
- `src/aoV2/restrictedMcp/server.js`
- `test/legalToolGateway.test.js`
- `test/evidenceLedger.test.js`
- `test/finalSelectionGate.test.js`
- `test/geminiNativeAoAdapter.test.js`
- `test/codexNativeAoAdapter.test.js`
- `test/aoV2Isolation.test.js`
- `test/m8-known10-live.js`
- `test/m8-live-mcp-proxy.js`
- `test/m8-live-mcp-proxy.cmd`
- `docs/CASE_FINDER_M8_PROVIDER_NATIVE_AO_V2_REPORT.md`

기존 AO/D 파일은 변경하지 않았어요. private raw trace와 live artifact는 `test/private/` 아래에 보존했고 Git 추적 대상에는 포함하지 않았어요.

## 6. 현재 판단 및 대기

Phase A architecture contract는 valid하고, Known-10 및 fresh golden-17 provider live diagnostic도 완료했어요. `npm run verify`의 서버 미기동 실패와 provider live 결과는 별도로 기록했어요.

현재 상태는 `M8_USER_REVIEW_REQUIRED`예요. Known-10 일반 checkpoint와 fresh golden-17 실행은 완료했지만, 이 결과만으로 제품 승격이나 추가 continuation으로 자동 진행하지 않아요.

## 7. Live Known-10 Diagnostic

실행 조건:

- population: `test/golden.json`에서 handoff가 지정한 Known-10
- Luna: Codex CLI `0.147.0-alpha.6.5`, `gpt-5.6-luna`, reasoning `medium`
- sandbox: Codex `read-only`
- MCP: `search_decisions`, `get_decision_text`, `search_law`, `get_law_text`만 노출
- selection gate: detail-verified evidence만 최종 출력 가능
- 질문별 새 ledger/gateway/telemetry/safety/provider session 생성

최종 aggregate:

| arm | strict hit | output valid | model protocol clean | repaired output | protocol failure | forbidden contamination |
|---|---:|---:|---:|---:|---:|---:|
| Gemini | 2/10 | 10/10 | 9/10 | 1/10 | 1/10 | 0 |
| Luna | 4/10 | 10/10 | 9/10 | 1/10 | 1/10 | 0 |

Luna의 일반 M8 Known-10 checkpoint는 `strict >= 4/10`, `protocol failure <= 2/10`, `forbidden contamination = 0`을 충족해요. 다만 strong checkpoint인 `strict >= 5/10`은 충족하지 못했어요. 따라서 host repair로 안전한 출력이 된 1건을 모델 protocol 개선으로 세지 않고, Luna 결과는 `M8_KNOWN10_DIAGNOSTIC_COMPLETE`로만 보존해요.

Luna aggregate 호출/토큰 계측은 legal tool 72회(search 34, detail 38), input 1,061,334, cached input 763,904, output 9,307, reasoning 4,391이에요. Gemini은 legal tool 30회(search 20, detail 10), input 204,619, output 1,619이에요.

첫 단일 프로세스 full run은 Codex session이 MCP event 대기 중 정지해 watchdog 대상이 되었어요. 이후 session timeout event를 parent queue에 전달하도록 보강한 뒤, 완료된 0–4번 기록과 재개한 5–9번 기록을 합산했어요. 첫 시도의 미완료/중단 기록은 aggregate에 포함하지 않았어요.

최종 Luna raw records:

- `test/private/m8-known10-live-final-v2/luna/known10-records.jsonl` — plan index 0–4
- `test/private/m8-known10-live-continuation-v2/luna/known10-records.jsonl` — plan index 5–9

Gemini aggregate:

- `test/private/m8-known10/gemini/known10-summary.json`

질문별 `ledger_scope_id`는 Luna 최종 10개 record에서 모두 고유했고, 오프라인 isolation fixture는 질문 A에서 관측한 ID가 질문 B detail에 사용되지 않으며 scope가 분리됨을 확인했어요. 따라서 persistent Codex session을 사용하더라도 ledger와 observed-id scope가 질문 단위로 격리되는 계약을 확인했어요.

제품 `main` 통합, commit/push는 수행하지 않았어요.

## 8. Fresh Golden-17 Comparison

설계 변경 없이 동일한 AO-v2 provider-native core, validator, telemetry, restricted MCP surface를 사용해 `test/golden.json`의 자연어 정답 보유 17문항을 새로 실행했어요. Gemini와 Luna는 각각 독립 실행했으며 전체 34/34 record가 완료됐어요.

M8 결과:

| arm | strict hit | output valid | model protocol clean | repaired output | protocol failure | forbidden contamination |
|---|---:|---:|---:|---:|---:|---:|
| Gemini | 4/17 (23.5%) | 16/17 | 13/17 | 3/17 | 4/17 | 0 |
| Luna | 9/17 (52.9%) | 17/17 | 10/17 | 7/17 | 7/17 | 0 |

M8 protocol failure 원인:

| arm | 원인 | 건수 | 의미 |
|---|---|---:|---|
| Gemini | `MODEL_UNVERIFIED_SELECTION_ATTEMPT` | 3 | 검색은 됐지만 상세검증되지 않은 사건번호를 최종 선택함. host gate가 제거함. |
| Gemini | `SAFETY_NO_PROGRESS` | 1 | 진행 watchdog가 중단하여 output invalid로 종료함. |
| Luna | `INTRO_CASE_NUMBER_REMOVED` | 4 | 검증된 선택과 별개로 intro에 사건번호를 작성하여 host가 intro를 제거함. |
| Luna | `RESULT_MAX_TRUNCATED` | 1 | result max를 초과한 선택을 host가 잘라냄. |
| Luna | `CASE_NOT_OBSERVED` | 2 | 검색에서 관측되지 않은 사건번호를 최종 선택하여 host가 제거함. |

M7 동일 17문항과의 참고 비교:

| 비교 arm | strict hit | protocol/출력 계측 | 해석 |
|---|---:|---:|---|
| M7 G-AO | 8/17 (47.1%) | legacy protocol pass 17/17 | 기존 AO 결과 |
| M8 Gemini | 4/17 (23.5%) | output valid 16/17; model clean 13/17 | strict hit는 M7 G-AO보다 낮음 |
| M7 L-AO | 2/17 (11.8%) | legacy protocol pass 14/17; fallback 3 | 기존 Luna AO 결과 |
| M8 Luna | 9/17 (52.9%) | output valid 17/17; model clean 10/17 | strict hit는 M7 L-AO보다 높고 fallback은 없음 |

M7의 `protocol pass`와 M8의 `model_protocol_clean`은 동일한 gate가 아니에요. 따라서 protocol 수치를 직접 승패 비교하지 않고, strict hit와 M8의 안전성/원본 protocol 계측을 분리해 해석해야 해요. 특히 M8 Luna는 strict hit는 개선됐지만, 7건에서 host repair가 발생했으므로 orchestration protocol 자체가 clean하다고 볼 수 없어요.

M8 fresh golden-17 raw artifacts:

- Gemini summary/records: `test/private/m8-golden17-live-final/gemini/golden17-summary.json`, `golden17-records.jsonl`
- Luna summary/records: `test/private/m8-golden17-live-final-luna/luna/golden17-summary.json`, `golden17-records.jsonl`

이번 fresh run은 strict accuracy 비교를 위한 실행이며, validator 완화나 intro 우회 설계는 적용하지 않았어요.
