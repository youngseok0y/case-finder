# Case Finder 최종 보고서

## 1. 보고서 개요

- 기준일: 2026-08-11
- 저장소: `youngseok0y/case-finder`
- 작업 브랜치: `Agentic_diagnose`
- 최신 커밋: `df28007` (`add final M6C evaluation report`)
- 평가 스위트: `m5-golden-1`
- 범위: 결정론 arm D, 제한형 에이전틱 arm A6, open-horizon arm AO

이 보고서는 Agentic tool surface 동결 이후 구현 변경과 M6C 비교 screening 결과를 정리한다. 정확성 계약 A1~A7은 유지했으며, 이번 결과만으로 제품 기본 arm을 확정하지 않는다.

## 2. 결론 요약

AO는 이번 30문항 1회 비교에서 D/A6보다 높은 golden protocol 통과율과 final selection recall을 보였다.

| arm | golden protocol PASS | final selection recall* | 평균 Gemini 요청 | fallback 사용 |
|---|---:|---:|---:|---:|
| D | 19/30 (63.3%) | 0.522 | 2.00 | 0 |
| A6 | 19/30 (63.3%) | 0.478 | 4.42 | 5 |
| AO | 21/30 (70.0%) | 0.565 | 4.89 | 2 |

`*` 기대 사건번호가 비어 있는 함정형 문항은 recall 평균에서 제외했다.

다만 이번 실행은 arm별 3회 반복이 아닌 `30문항 × 3 arm = 90건`의 1회 비교다. 또한 명세가 요구하는 사람의 상위 5건 관련성 점수도 없다. 따라서 현재 결론은 “AO를 후속 반복 평가의 우선 후보로 유지”하는 수준이며, 최종 제품 채택 결정은 보류한다.

## 3. 구현 완료 사항

### 3.1 실행 환경과 서버 기동

- Node.js 허용 범위를 `>=24.14.0 <25`로 고정했다.
- `start.bat`가 시작 전에 설정 포트의 LISTENING PID를 찾고, 기존 프로세스를 종료한 뒤 포트 해제를 확인하고 서버를 시작하도록 수정했다.
- 실험 arm은 D `3331`, A6 `3332`, AO `3333`을 사용했다. 기존 검증 서버 포트 `3330`은 건드리지 않았다.
- Node `v24.19.0`, MCP 연결, 세 arm의 `/health` 응답을 확인했다.

### 3.2 Agentic tool surface 동결

두 에이전틱 arm은 동일한 도구 surface와 구조화 응답을 사용하고, 질문당 호출 상한만 다르게 운용한다.

- `search_decisions`에서 `domain === "precedent"`일 때만 `options.search = 2`를 적용했다.
- 헌재·행정 도메인에는 해당 파라미터를 전달하지 않는다.
- 함수 스키마의 `display.maximum`을 전역 `SEARCH_DISPLAY` 설정과 맞췄다. 기본값은 20이다.
- 검색 결과를 원시 MCP 문자열의 임의 4,000자 절단으로 전달하지 않고 `total`과 `items[{id, caseNumber, title, court, date, ...}]` 구조로 압축한다.
- 판례 상세는 전체 원문을 Gemini에 무제한 전달하지 않고 판시사항·판결요지·필요 메타데이터 중심의 구조화 결과를 사용한다.
- 다음 관측 필드를 분리 기록한다.

  - `raw_agent_candidates`
  - `raw_agent_selection`
  - `agent_stop_reason`
  - `fallback_used`
  - `final_product_output`

결정론 후보와 에이전트 후보가 최종 출력에서 섞여 보이지 않도록 fallback 후보 집합과 사유도 별도 기록한다.

### 3.3 운영 제어와 관측

- AO는 `MODEL_FINAL`, `NO_NEW_EVIDENCE`, `RPD_RESERVE_STOP`, `SAFETY_WATCHDOG_STOP` 등을 구분한다.
- 질문당 Gemini 요청 수, 재시도 수, 입·출력 토큰, MCP 검색·상세 호출 수, elapsed time을 수집한다.
- 앱 내부 보수 한도는 RPM 13, RPD 450이며 AO reserve는 30이다.
- 외부 RPD 경계 이후에도 screening runner가 계속 요청을 시도할 수 있도록 `--continue-after-quota=true`를 추가했다.
- 이 옵션은 runner의 skip guard만 우회한다. 앱 내부 rate limiter, fallback, stop reason 기록은 그대로 유지한다.

## 4. 평가 방법

### 4.1 평가 세트와 arm

`test/golden.json`의 30문항을 사용했다. 직접 조회, 자연어 검색, 관련 판례, 법령·도메인 질의, 희소 후보, 미존재 사건번호 함정형을 포함한다.

- D: 결정론 검색계획·후보선별, 질문당 Gemini 2회
- A6: 제한형 agentic, 질문당 최대 6회
- AO: open-horizon agentic, 질문당 상한 대신 no-new-evidence·watchdog·rate safety stop 사용

### 4.2 실행 세그먼트

quota와 RPM 상태를 보존하기 위해 실행을 세 파일로 나눴다.

| 세그먼트 | 기록 수 | 상태 |
|---|---:|---|
| `clean2` | 60 | 20문항 × 3 arm |
| 이전 `tail2` | 15 | 5문항 × 3 arm, 이전 세션 |
| 새 세션 `session2-tail` | 15 | 5문항 × 3 arm, 외부 RPD 119에서 재개 |
| 합계 | 90 | 30문항 × 3 arm, case-arm 중복 없음 |

새 세션은 외부 RPD 관측값 119에서 시작해 144로 종료했고 quota skip은 0건이었다. 이전 세션 tail에는 AO의 내부 `RPD_RESERVE_STOP` 1건이 있으며, 이는 새 세션 baseline과 분리해 기록했다.

## 5. 결과 상세

### 5.1 회수·선택 지표

| arm | candidate recall* | raw agent selection recall* | final selection recall* | protocol PASS |
|---|---:|---:|---:|---:|
| D | 0.261 | 해당 없음 | 0.522 | 19/30 |
| A6 | 0.283 | 0.294 | 0.478 | 19/30 |
| AO | 0.370 | 0.438 | 0.565 | 21/30 |

`*` 기대 사건번호가 존재하는 문항만 포함했다. D에는 raw agent selection이 없다.

AO는 후보 집합 단계와 agent 선택 단계 모두에서 가장 높은 recall을 보였고, 최종 출력 recall도 가장 높았다. 그러나 fallback을 거친 최종 출력과 raw agent 결과는 별도 지표로 계산했으며, 이 차이를 agent 자체 성능으로 해석하지 않았다.

### 5.2 호출·중단·fallback

| arm | Gemini 합계 | 평균 | 주요 stop reason | fallback 사용 |
|---|---:|---:|---|---:|
| D | 38 | 2.00 | 해당 없음 | 0 |
| A6 | 84 | 4.42 | `MODEL_FINAL` 15, `QUESTION_CALL_LIMIT` 4 | 5 |
| AO | 93 | 4.89 | `MODEL_FINAL` 18, `RPD_RESERVE_STOP` 1 | 2 |

전체 기록에서 `expected_case_not_in_output` protocol failure는 31건이었다. HTTP·payload 오류나 중복 case-arm 기록은 없었다. 비어 있지 않은 최종 결과의 사건번호는 모두 후보 존재와 상세 조회 성공을 통과했으며, 측정된 non-empty 결과의 verified item rate는 100%였다.

### 5.3 해석

- AO는 A6보다 평균 호출 수가 약간 높지만, 이번 screening에서 최종 recall과 통과율이 높았다.
- AO는 D보다 Gemini 호출량이 약 2.45배이고 RPM pacing 때문에 실험 elapsed time 부담이 컸다.
- A6는 호출 상한 도달 fallback이 더 자주 발생했다.
- AO의 RPD reserve stop은 실패를 숨기지 않고 fallback과 별도 stop reason으로 남겼다.
- 관련성 점수, 반복 간 선택 집합 일치도, 질문별 비용 상관관계가 없어 “AO가 최종 제품에 적합하다”고 확정할 수 없다.

## 6. 정확성 계약 점검

- A1: 판시사항·판결요지·법령 조문은 법제처 API 원문 경로를 유지했다.
- A2: Gemini는 검색어 생성과 앱이 제시한 후보 내 선택만 수행한다.
- A3: 최종 사건번호는 후보 존재 및 상세 조회 성공 검증을 거친다.
- A4: 링크는 API 상세 링크 또는 검증된 일련번호 기반 URL만 사용한다.
- A5: 결과 없음과 정확 일치·관련 판례를 구분한다.
- A6: 고정 prompt/schema와 기본 생성 파라미터 정책을 유지한다.
- A7: Gemini 실패·상한·reserve stop 시 결정론 후보와 fallback을 분리 기록하고 출력한다.

검사 명령 `npm run check`는 통과했다. 최종 branch worktree도 clean 상태이며 원격 `Agentic_diagnose`에 최신 커밋이 반영되어 있다.

## 7. 최종 판단과 권고

### 현재 판단

현재 데이터만으로 D/A6/AO 중 하나를 제품 기본 arm으로 확정하지 않는다. AO는 후속 검증 우선순위가 가장 높지만, 이번 결과는 1회 screening의 유망 신호다.

### 다음 단계

1. 동일 golden 30문항을 각 arm별 3회 반복해 선택 집합 일치도와 stop 변동을 측정한다.
2. 각 실행의 상위 5건에 대해 운영자가 관련성 1~5점을 부여한다.
3. raw agent 결과, fallback 결과, 최종 출력, quota 비용을 분리해 arm별로 재집계한다.
4. 3회 반복과 사람 평가에서 정확성 100% 조건을 유지하는 arm만 제품 후보로 남긴다.
5. 최종 arm 확정 전까지 D/A6/AO 코드를 삭제하거나 비활성화하지 않는다.

## 8. 산출물

- 인수인계 문서: `docs/CASE_FINDER_HANDOFF_M6C_AO_OPEN_HORIZON_EVALUATION.md`
- 본 최종 보고서: `docs/CASE_FINDER_FINAL_REPORT_M6C.md`
- clean screening: `logs/m6c-screening-clean2-2026-08-11.jsonl`
- prior tail: `logs/m6c-screening-clean2-tail2-2026-08-11.jsonl`
- post-reset tail: `logs/m6c-screening-session2-tail-2026-08-11.jsonl`
- quota pilot: `logs/m6c-screening-pilot-2026-08-11.jsonl`
