# CASE-FINDER HANDOFF M6C
## AO Open-Horizon Agentic Evaluation
### 결정론 D / 제한형 A6 / 개방형 AO를 동일 검증 계층 아래 비교하여 orchestration 자유도의 실제 효용과 quota 비용을 측정한다

> 상태: **READY AFTER PRE-AO RETRIEVAL FIXES LAND**
>
> 대상 저장소: `youngseok0y/case-finder`
>
> 기준 제품: `main`
>
> 진입 SHA: **`7671a3d9aab9a358cf60f4746b8e957b8ee9eac4`** (`main`에 사전 단계 수정사항 푸시 완료)
>
> 실험 브랜치: **`Agentic_diagnose`** (사용자 지정 override; 문서의 권장 브랜치명 대신 사용)
>
> 현재 상태: **실호출 전 준비 완료. AO/D/A6 실험은 아직 시작하지 않음.**
>
> 실험 목적: **AO를 제품 기본모드로 즉시 채택하는 것이 아니라, 질문당 호출 상한을 풀었을 때 회수·관련성이 얼마나 개선되고 그 개선에 Gemini quota를 얼마나 더 소비하는지 측정한다.**
>
> 핵심 불변조건: **어느 모드가 이기든 `case-finder-spec.md §7.2 validator`는 그대로 유지한다.**
>
> 제품 통합: **평가 완료 전 금지**

---

## Current execution status — 2026-08-11

```text
branch: Agentic_diagnose
HEAD: 54404ad
external RPD baseline: 0/500 (user-confirmed new session)
local limiter baseline: 0
AO reserve: 30
offline check: npm run check PASS
pilot: natural-rent-deposit, D/A6/AO = PASS/PASS/PASS
pilot Gemini requests: D=2, A6=5, AO=2
pilot observed external RPD: 9/500
full M6C screening: pending
```

The pilot output is recorded in `logs/m6c-screening-pilot-2026-08-11.jsonl`. Full screening remains evaluation-only; no product integration decision has been made.

## Final execution status — 2026-08-11

The earlier status block is superseded by this completed screening record.

```text
branch: Agentic_diagnose
latest implementation base: 72a6e1c
screening runner follow-up: continue-after-quota=true is available
external RPD reset baseline: 119/500
new-session tail: 15/15 records, observed external RPD 144/500, quota skips 0
combined screening: 90/90 records = 30 cases x D/A6/AO, no duplicate case-arm pairs
segments: clean2 60 + prior tail2 15 + new-session tail 15
syntax/check: npm run check PASS
evaluation status: complete for the current m5-golden-1 suite
product decision: pending; evaluation-only, no arm promoted
```

Aggregate results over the 30-case suite:

| arm | valid | fallback used | final selection recall* | candidate recall* | raw agent selection recall* |
|---|---:|---:|---:|---:|---:|
| D | 19/30 | 0 | 0.522 | 0.261 | n/a |
| A6 | 19/30 | 5 | 0.478 | 0.283 | 0.294 |
| AO | 21/30 | 2 | 0.565 | 0.370 | 0.438 |

`*` Recall averages exclude cases whose gold set is intentionally empty. The runner recorded 31 `expected_case_not_in_output` protocol failures; no duplicate records, HTTP protocol errors, or unverified non-empty final items were observed. The prior tail contains one explicitly recorded `RPD_RESERVE_STOP` (`agent_error_reason: 일일 reserve`) and remains separate from the post-reset session baseline.

The external quota guard remains conservative by default. For the user's instruction to continue after the external RPD boundary, future screening runs may pass `--continue-after-quota=true`; this bypasses only the runner's skip guard. The application-level RPM/RPD reserve and fallback behavior remain enforced and logged.

# 0. 배경

현재 `case-finder`는 자연어 질의에 대해 두 가지 검색 경로를 운용·시험 중이다.

```text
D   = deterministic
A6  = bounded agentic, 질문당 Gemini 요청 최대 6회
```

최근 `law_test_v2`의 H12-Z 진단에서는 Direct가 다수 문항에서 강한 회수 우위 신호를 보였지만,
5문항 전체에서 단일 아키텍처 방향이 확정되지는 않았다.

유효한 최종 terminal은:

```text
H12Z_ARCHITECTURE_CAUSALITY_NOT_ESTABLISHED
```

였고, Direct strong-win은 HZ1~HZ4, Proxy strong-win은 HZ5에서 관측되었다.

따라서 여기서 도출할 수 있는 결론은:

```text
"모든 orchestration을 제거해야 한다"
```

가 아니라,

```text
"검색 판단을 제한하는 예산·노출·tool-use 제약이 실제 제품 성능을 얼마나 제한하는지
case-finder 자체에서 직접 측정할 가치가 있다"
```

이다.

이번 M6C에서는 세 번째 평가 arm:

```text
AO = Agentic Open-horizon
```

을 추가한다.

---

# 1. 이번 실험이 답하려는 질문

M6C는 다음 네 질문에 답한다.

## Q1. 검색 품질

```text
AO가 A6보다 기대 판례를 더 자주 후보 풀에 회수하는가?
```

## Q2. 최종 관련성

```text
AO가 A6보다 실제 출력 상위 판례의 관련성을 높이는가?
```

## Q3. 한계효용

```text
관련성 또는 recall 1단위를 더 얻기 위해
Gemini 요청을 평균 몇 회 더 소비해야 하는가?
```

## Q4. 운영 가능성

```text
AO의 평균 Gemini 요청 수가 RPD 450 운영 한도에서
하루 처리 가능한 질문 수를 어느 정도까지 감소시키는가?
```

즉 이번 실험은:

```text
"AO가 더 좋다 / 나쁘다"
```

가 아니라:

```text
"AO의 추가 검색 자유도가 실제로 얼마의 품질을 사고,
그 품질을 사기 위해 얼마의 quota를 지불하는가"
```

를 측정한다.

---

# 2. 사전 단계 완료 조건

사용자가 현재 진행 중인 retrieval 수정은 M6C의 실험축이 아니다.

따라서 AO 구현 전에 아래 조건을 **D/A6/AO 공통 기반**으로 동결해야 한다.

최소 확인 항목:

```text
1. precedent search에서 의도한 본문검색 옵션 적용
2. agentic search tool의 display 계약과 executor/config 불일치 제거
3. tool-result representation / 절단 정책 정리
4. raw agent 결과와 fallback 결과를 분리 기록
5. 직접 사건번호 검증 로직 정상
6. MCP 의존성 버전 고정
7. npm run check PASS
```

사전 단계 수정이 완료되면:

```text
PRE_AO_BASE_SHA=<commit>
```

를 기록하고 M6C branch를 그 SHA에서 생성한다.

M6C에서는 사전 단계의 검색 품질 수정과 AO 호출 상한 효과를 동시에 변경하지 않는다.

---

# 3. 세 평가 모드

## 3.1 D — Deterministic

현재 제품의 결정론 경로.

원칙:

```text
Gemini 검색계획 생성
→ 코드 기반 MCP 검색
→ 코드 랭킹
→ Gemini 후보 선별
→ §7.2 validator
```

D는 제품 baseline이다.

D와 AO의 차이는 여러 축이므로
AO 호출 상한 효과의 직접 causal comparator로 사용하지 않는다.

---

## 3.2 A6 — Bounded Agentic

사전 수정이 반영된 에이전틱 경로.

```text
AGENTIC_CALL_MAX = 6
```

그 외 AO와 동일한:

```text
model
prompt
tool declarations
MCP version
search options
tool-result representation
selection schema
fallback policy
validator
renderer
RPM/RPD limiter
```

를 사용한다.

---

## 3.3 AO — Agentic Open-horizon

`AO`는 제품 정식모드가 아니라 **진단용 open-horizon arm**이다.

A6와의 유일한 의도적 차이:

```text
질문당 Gemini 요청 수 6회 상한을 제거
```

한다.

AO에서 제거하는 것:

```text
AGENTIC_CALL_MAX=6에 의한 질문당 종료
rateLimiter의 questionCalls >= AGENTIC_CALL_MAX 차단
```

AO에서 유지하는 것:

```text
Gemini RPM 보호
Gemini RPD 보호
TPM/context 방어
허용 tool whitelist
MCP timeout/reconnect
source provenance
candidate closed-world validation
§7.2 validator
renderer
fallback 표시
사용자 취소 가능성
```

AO는 "검증 없는 자유검색"이 아니다.

**검색 자율성만 넓히고, 출력 검증과 운영 안전장치는 유지한다.**

---

# 4. 절대 불변: §7.2 validator

어느 모드가 이기더라도 validator를 제거하거나 완화하지 않는다.

현재 제품 계약의 핵심:

```text
1. 출력 사건번호가 후보 집합에 실제 존재
2. 각 사건번호 get_decision_text 성공 확인
3. NOT_FOUND / HALLUCINATION_DETECTED 실패 처리
4. intro의 검증되지 않은 사건번호·조문 제거
5. 검증 실패 로그 기록
```

이다.

M6C에서 비교하는 것은:

```text
후보를 어떻게 회수하고 선택하는가
```

뿐이다.

비교하지 않는 것:

```text
실존 검증을 할지 말지
```

따라서 다음은 금지한다.

```text
AO니까 validator 생략
AO니까 후보 밖 사건번호 허용
AO니까 get_decision_text 재검증 생략
AO니까 hallucination marker 무시
```

출력 사건번호 실존율이 100% 미만인 arm은
기존 §6.4 계약대로 즉시 제품 후보에서 탈락한다.

---

# 5. AO 종료 조건

"Open-horizon"은 무한루프 허용을 의미하지 않는다.

질문당 **고정 Gemini 요청 상한은 두지 않되**,
다음 운영·진전 기반 종료 조건을 둔다.

## 5.1 모델 정상 종료

모델이 function call 없이
최종 selection JSON을 반환하면 종료한다.

```text
stop_reason = MODEL_FINAL
```

## 5.2 반복 호출 방지

동일:

```text
tool_name + canonical_arguments
```

호출은 provider에 재전송하지 않는다.

가능하면 cached result를 반환한다.

동일 호출 패턴이 반복되어
새 evidence가 생성되지 않으면 trace에 기록한다.

## 5.3 No-new-evidence stop

연속 3개의 agentic turn 동안 다음이 모두 없으면 종료한다.

```text
새 search query
새 provider/case number
새 detail source
```

marker:

```text
NO_NEW_EVIDENCE
```

## 5.4 RPD reserve

앱 내부 RPD 450을 모두 한 질문에 소비하지 않는다.

권장:

```text
AO_RPD_RESERVE = 30
```

즉 현재 usage에서 reserve를 침범하는 호출은 시작하지 않는다.

이 조건으로 종료되면:

```text
RPD_RESERVE_STOP
```

을 기록한다.

이는 retrieval failure와 분리한다.

## 5.5 Wall-clock watchdog

비정상 반복이나 transport 문제에 대비한 비상 제한만 둔다.

권장 기본:

```text
AO_WALL_CLOCK_MAX = 10분
```

발동 시:

```text
SAFETY_WATCHDOG_STOP
```

으로 기록하고 일반적인 검색 품질 실패와 분리한다.

이 watchdog을 AO 성능을 억제하는 정상 예산으로 사용하지 않는다.

---

# 6. Gemini / MCP quota 계측

Claude 제안의 핵심을 M6C primary metric으로 승격한다.

각 질문·각 실행마다 반드시 기록:

```text
gemini_requests
gemini_retry_requests
gemini_input_tokens
gemini_output_tokens
mcp_calls_total
mcp_search_calls
mcp_detail_calls
elapsed_ms
stop_reason
fallback_used
```

## 6.1 질문당 Gemini 요청 수

arm별:

```text
avg_gemini_requests_per_question
median_gemini_requests_per_question
p90_gemini_requests_per_question
max_gemini_requests_per_question
```

를 계산한다.

평균만으로 긴 꼬리(long tail)를 숨기지 않는다.

## 6.2 하루 처리 가능 질문 수

제품 운영 한도는 앱 내부 RPD 450을 기준으로 계산한다.

이론적 최대:

```text
daily_question_capacity
= floor(450 / avg_gemini_requests_per_question)
```

안전 reserve 30을 적용한 보수적 capacity도 같이 계산한다.

```text
safe_daily_question_capacity
= floor((450 - 30) / avg_gemini_requests_per_question)
```

예:

```text
평균 6회  → safe capacity 약 70문항/일
평균 12회 → safe capacity 약 35문항/일
평균 28회 → safe capacity 약 15문항/일
```

AO가 품질에서 크게 이겨도
하루 처리량이 운영 요구보다 낮으면
제품 기본모드 채택 근거가 되지 않는다.

---

# 7. 품질 평가 단위

기존 §6.4와의 호환성을 유지한다.

## 7.1 실존율 — Hard Gate

```text
verified_output_rate
```

출력 사건번호가 validator를 모두 통과한 비율.

제품 후보 조건:

```text
100%
```

미만이면 즉시 탈락.

---

## 7.2 Gold recall

질문별 기대 판례가 있는 경우:

### Candidate recall

에이전트가 관측한 후보 집합에 기대 판례가 한 번이라도 등장:

```text
candidate_gold_hit
```

### Selection recall

최종 selected에 기대 판례 포함:

```text
selected_gold_hit
```

둘을 분리한다.

이 분리가 있어야:

```text
검색 실패
vs
찾았지만 선택 실패
```

를 구분할 수 있다.

---

## 7.3 사람 관련성 평가

상위 최대 5개 판례에 대해
기존 §6.4의 사람 평가 1~5점을 유지한다.

반드시 동일 evaluator/rubric으로 D/A6/AO를 blind 또는 최소 arm-masked 방식으로 평가한다.

질문별:

```text
relevance_mean_top5
relevance_best
irrelevant_count
```

arm 전체:

```text
mean_relevance
median_relevance
```

를 계산한다.

AO가 후보를 많이 찾는 것만으로 이긴 것으로 판정하지 않는다.

---

# 8. 핵심 비용-품질 지표

이번 M6C의 중심이다.

## 8.1 AO 추가 quota 비용

```text
delta_requests
= avg_requests_AO - avg_requests_A6
```

## 8.2 관련성 증가

```text
delta_relevance
= mean_relevance_AO - mean_relevance_A6
```

## 8.3 관련성 1점 추가 비용

`delta_relevance > 0`인 경우:

```text
requests_per_relevance_point
= delta_requests / delta_relevance
```

예:

```text
A6 관련성 평균 3.4 / 평균 5.8 requests
AO 관련성 평균 4.0 / 평균 11.8 requests

delta relevance = +0.6
delta requests  = +6.0

관련성 +1.0점을 얻는 비용 ≈ 추가 Gemini 요청 10회
```

이 값을 실제 제품 채택 판단에 사용한다.

`delta_relevance <= 0`이면:

```text
NOT_APPLICABLE_NO_RELEVANCE_GAIN
```

으로 기록한다.

## 8.4 Gold recall 1건 추가 비용

AO가 A6보다 추가로 맞힌 golden question 수:

```text
extra_selected_gold_hits
```

가 양수이면:

```text
extra_requests_per_added_gold_hit
=
(total_requests_AO - total_requests_A6)
/
extra_selected_gold_hits
```

를 계산한다.

이 값은:

```text
"정답 판례 한 질문을 추가로 살리기 위해
Gemini quota를 몇 요청 더 쓰는가"
```

를 보여준다.

---

# 9. 호출별 한계효용 곡선

AO의 가장 중요한 연구 산출물 중 하나다.

각 AO 질문에서 Gemini request index별로:

```text
새 provider ID 발견
새 gold candidate 발견
새 selected gold 확보
새 reviewer-usable precedent 확보
```

를 기록한다.

집계:

```text
request <= 2
request <= 4
request <= 6
request <= 8
request <= 10
request <= 12
request > 12
```

구간별 누적 recall / usable evidence gain을 계산한다.

목적:

AO가 이기더라도 최종 제품에서:

```text
정말 무상한 open-horizon이 필요한가
또는
대부분의 이득이 8~12회 안에서 포화되는가
```

를 판단한다.

---

# 10. Instrumentation

기존 agentic 결과에 다음 trace를 추가한다.

질문별 최소 event:

```json
{
  "question_id": "...",
  "arm": "A6 | AO",
  "gemini_request_index": 7,
  "tool_call_index": 12,
  "tool": "search_decisions",
  "query": "...",
  "returned_case_numbers": [],
  "new_case_number_count": 0,
  "opened_case_number": null,
  "candidate_gold_seen": false,
  "selected_gold_seen": false,
  "input_tokens": 0,
  "output_tokens": 0,
  "elapsed_ms": 0
}
```

검색어는 평가 trace에 기록하되
제품 UI에 노출할 필요는 없다.

secret/API key/raw credential은 절대 trace에 기록하지 않는다.

---

# 11. Fallback 분리

현재 제품은 agentic 실패·상한 도달 시
결정론 fallback을 사용할 수 있다.

평가에서는 다음을 반드시 분리한다.

```text
raw_agent_candidate_set
raw_agent_selection
agent_stop_reason
fallback_used
fallback_candidate_set
final_product_output
```

AO가 실패한 뒤 deterministic fallback으로 맞힌 결과를
AO 자체의 recall로 계산하지 않는다.

다음 두 지표를 별도로 계산한다.

```text
raw_agent_selected_gold_hit
final_product_selected_gold_hit
```

---

# 12. 평가 세트

기존 `test/golden.json`의 업무형 질문 세트를 사용한다.

조건:

```text
20~30문항
직접 일치형 포함
관련 판례형 포함
함정형 포함
기대 판례는 수동 확인된 값만 사용
```

M6C 때문에 질문별 정답을 새로 튜닝하거나
AO 결과를 보고 golden을 수정하지 않는다.

---

# 13. 실행 단계

전체 3회 반복을 처음부터 수행하면 AO가 RPD를 크게 소모할 수 있다.

따라서 **Screening → Confirmation** 2단계로 수행한다.

## Phase 1 — Screening

각 arm을 전체 평가 세트에 1회 실행.

```text
D   × N × 1
A6  × N × 1
AO  × N × 1
```

목적:

```text
AO가 추가 품질 신호를 보이는지
AO의 평균/꼬리 호출량이 어느 정도인지
RPD 운영상 지속 가능한지
```

확인.

### 실행 순서

quota·시간 편향 방지를 위해
질문별 arm 순서를 순환한다.

예:

```text
Q1: D → A6 → AO
Q2: A6 → AO → D
Q3: AO → D → A6
```

AO는 동일 일일 quota 후반에만 몰아넣지 않는다.

---

## Phase 2 — Confirmation

다음 중 하나 이상이면 confirmation 진행:

```text
1. AO selected_gold_hit가 A6보다 최소 3문항 이상 증가
2. AO mean relevance가 A6보다 +0.30 이상 증가
3. AO가 A6 실패 문항에서 reviewer-usable 판례를 반복적으로 추가 회수
```

Confirmation에서는:

```text
A6
AO
```

를 우선 3회 반복한다.

D는 screening에서 baseline 용도로 유지하되,
D/A6/AO 최종 제품 비교가 필요한 경우에만 D 3회 반복을 추가한다.

AO가 screening에서 품질 증가 없이 quota만 증가하면
confirmation을 수행하지 않고 종료한다.

---

# 14. RPD 운영 규칙

앱 내부 operational ceiling:

```text
RPD = 450
```

실험 reserve 권장:

```text
30
```

따라서 하루 실험 최대 계획 사용량:

```text
<= 420 requests
```

실험 시작 전에:

```text
remaining_rpd
planned_worst_case
reserve
```

를 보고한다.

AO는 질문당 고정 상한이 없으므로
사전에 정확한 worst-case RPD를 계산할 수 없다.

대신:

```text
current remaining RPD - reserve
```

가 절대 캠페인 ceiling이다.

reserve 도달 시 다음 질문으로 넘어가지 않고
그날 campaign을 종료한다.

RPD 때문에 중단된 질문은:

```text
CENSORED_BY_DAILY_QUOTA
```

로 별도 기록하며
일반 accuracy denominator 처리 방식을 보고서에 명시한다.

---

# 15. 평가 결과 표 — 필수

최종 보고서는 최소 다음 표를 포함한다.

## 15.1 품질

| metric | D | A6 | AO |
|---|---:|---:|---:|
| verified output rate | | | |
| candidate gold recall | | | |
| selected gold recall | | | |
| mean relevance | | | |
| median relevance | | | |
| selected-set repeat stability | | | |

## 15.2 비용

| metric | D | A6 | AO |
|---|---:|---:|---:|
| avg Gemini requests / question | | | |
| median requests | | | |
| p90 requests | | | |
| max requests | | | |
| avg MCP calls | | | |
| avg elapsed time | | | |
| safe daily question capacity | | | |

## 15.3 A6 → AO 한계효용

```text
Δ selected gold recall
Δ mean relevance
Δ average Gemini requests
requests per +1 relevance point
extra requests per added gold hit
safe daily capacity loss
```

---

# 16. 결정 규칙

## 16.1 AO 채택 후보

AO를 기본 agentic 제품 후보로 검토하려면 모두 충족:

```text
verified output rate = 100%
selected gold recall > A6
mean relevance > A6
추가 quota 비용이 운영 가능한 수준
safe daily question capacity가 실제 업무 처리량을 만족
```

"조금 더 좋다"만으로 채택하지 않는다.

---

## 16.2 AO가 품질은 좋지만 너무 비쌈

예:

```text
AO 관련성·recall은 명확히 증가
하지만 safe daily capacity가 업무 요구보다 낮음
```

이면 AO를 기본모드로 채택하지 않는다.

대신 후속 제품 설계 후보:

```text
A6 default
→ 충분한 evidence 미확보 시
→ AO rescue
```

로 기록한다.

M6C 안에서 rescue mode까지 구현하지 않는다.

---

## 16.3 AO ≈ A6

```text
관련성 차이 미미
recall 차이 미미
quota는 AO가 더 많이 소비
```

이면 질문당 6회 상한은 주요 병목이 아니다.

결론:

```text
A6 유지
AO 제품화 중단
```

---

## 16.4 AO < A6

AO가 검색을 과도하게 확산시키고
관련성이 떨어지거나 불안정성이 커지면:

```text
A6 승
```

으로 종료한다.

---

## 16.5 D가 여전히 우세

D가 A6/AO보다 품질과 비용에서 우세하면:

```text
D를 제품 기본 후보로 유지
agentic은 rescue/실험 경로로 격리
```

한다.

AO의 존재 때문에 D를 자동 폐기하지 않는다.

---

# 17. Stop-loss

M6C는 다음을 자동 생성하지 않는다.

```text
AO8
AO12
AO16
새 query template arm
새 ranking arm
새 model arm
새 MCP version arm
```

AO가 이긴 경우에도
이번 실험에서 얻은 호출별 한계효용 곡선을 이용해
**다음 제품 상한을 설계**한다.

새 숫자별 ablation campaign을 다시 시작하지 않는다.

---

# 18. 코드 변경 원칙

권장 방식:

```text
PIPELINE_MODE=deterministic
PIPELINE_MODE=agentic
PIPELINE_MODE=agentic_open
```

또는 내부 실험 flag로:

```text
AGENTIC_MODE=bounded | open
```

어느 방식이든
A6/AO가 같은 `runAgenticSearch()` 코드를 최대한 공유해야 한다.

금지:

```text
AO 전용 검색어 프롬프트
AO 전용 tool schema
AO 전용 search=2 정책
AO 전용 candidate parser
AO 전용 validator
```

유일한 의도적 차이:

```text
question-call ceiling
+
AO의 no-new-evidence / RPD reserve / watchdog 안전 종료
```

이다.

---

# 19. rateLimiter 수정 방향

현재 `reserveGeminiCall()`은:

```text
RPM
RPD
questionCalls >= agenticCallMax
```

를 함께 검사한다.

AO에서는 질문당 한도 검사만 비활성화한다.

개념:

```js
reserveGeminiCall(now, {
  questionCalls,
  enforceQuestionLimit: mode !== "open",
});
```

다음은 공통 유지:

```text
RPM 13
RPD 450
429 retry 1회
usage.json persistence
```

AO의 Gemini 요청도 반드시 usage.json에 똑같이 누적한다.

quota 계측을 우회하는 "직접 호출"을 만들지 않는다.

---

# 20. 필수 테스트

## Mode isolation

```text
test_a6_and_ao_share_model
test_a6_and_ao_share_prompt
test_a6_and_ao_share_tool_schema
test_a6_and_ao_share_search_options
test_a6_and_ao_share_tool_result_representation
test_a6_and_ao_share_validator
```

## Limit behavior

```text
test_a6_stops_at_six_gemini_requests
test_ao_does_not_stop_at_six
test_ao_still_respects_rpm
test_ao_still_respects_rpd
test_ao_respects_rpd_reserve
test_ao_no_new_evidence_stop
test_ao_watchdog_is_safety_only
```

## Accounting

```text
test_every_gemini_attempt_counts_toward_usage
test_retry_counts_as_request
test_question_request_count_recorded
test_raw_agent_and_fallback_metrics_are_separate
test_safe_daily_capacity_calculation
test_requests_per_relevance_point_calculation
```

## Validator

```text
test_validator_runs_for_d
test_validator_runs_for_a6
test_validator_runs_for_ao
test_ao_cannot_emit_unobserved_case_number
test_ao_not_found_is_removed_before_render
```

---

# 21. Checkpoints

## Checkpoint A — Pre-AO base frozen

```text
M6C_PRE_AO_BASE_READY

base SHA
npm run check
MCP version
search policy parity
tool-result representation parity
fallback/raw separation
validator unchanged
```

## Checkpoint B — AO offline implementation

```text
M6C_AO_OFFLINE_READY

branch / HEAD
tests
A6 max request = 6
AO fixed question-call max = none
RPM/RPD limits
RPD reserve
no-new-evidence rule
validator hash/unchanged confirmation
```

실호출 전 사용자 승인.

## Checkpoint C — Screening

```text
M6C_AO_SCREENING_COMPLETE

N questions
D/A6/AO valid runs
verified rate
candidate recall
selection recall
relevance
avg/median/p90 Gemini requests
safe daily capacity
confirmation gate
```

## Checkpoint D — Confirmation

필요한 경우만:

```text
M6C_AO_CONFIRMATION_COMPLETE

repeat stability
quality deltas
quota deltas
marginal utility metrics
```

---

# 22. Terminal 상태

정확히 하나:

```text
M6C_AO_PRODUCT_CANDIDATE
M6C_AO_RESCUE_ONLY_CANDIDATE
M6C_A6_RETAINED
M6C_DETERMINISTIC_RETAINED
M6C_INCONCLUSIVE
M6C_PROTOCOL_INVALID
```

---

# 23. 최종 보고서에 반드시 답할 질문

최종 보고서는 서술적으로 다음 여섯 질문에 답한다.

```text
1. AO는 A6보다 관련성이 실제로 좋아졌는가?
2. AO는 A6보다 기대 판례 recall을 실제로 높였는가?
3. 그 개선을 위해 질문당 Gemini 요청을 평균 몇 회 더 썼는가?
4. 관련성 +1점 또는 추가 gold hit 1건당 추가 요청 비용은 얼마인가?
5. RPD 450에서 각 모드의 하루 처리 가능 질문 수는 몇 건인가?
6. 품질과 quota를 함께 볼 때 실제 제품 기본모드로 무엇을 채택해야 하는가?
```

---

# 24. 최종 원칙

이번 실험의 판단 기준은:

> **최고 점수만 고르는 것이 아니라, 검증된 관련성을 가장 효율적인 quota 비용으로 확보하는 경로를 고르는 것이다.**

그리고 다음은 실험 결과와 무관하게 유지한다.

> **검색이 아무리 자유로워져도 출력 전 실존 검증은 자유로워지지 않는다.**
>
> AO는 retrieval 자유도를 시험하는 모드이지, `§7.2 validator`를 우회하는 모드가 아니다.
