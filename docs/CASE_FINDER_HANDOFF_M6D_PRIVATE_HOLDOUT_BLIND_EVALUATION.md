# CASE-FINDER HANDOFF M6D
## Private Holdout Blind Evaluation & Baseline Reanalysis
### 기존 M6C 90건을 독립 재정산하고, RPM pacing을 교정한 뒤 새로운 10문항으로 D / A6 / AO의 일반화 성능·관련성·quota 효율을 블라인드 검증한다

> 상태: **PHASE F 완료 — M6D_D_RETAINED**
>
> 저장소: `youngseok0y/case-finder`
>
> 기준 브랜치: `Agentic_diagnose`
>
> 기준 HEAD: `df28007c52cd48fdb8fd5066ee4bdf209a42b0ff`
>
> 기준 보고서: `docs/CASE_FINDER_FINAL_REPORT_M6C.md`
>
> 새 실험 브랜치 권장: `m6d-private-holdout-blind-eval`
>
> 제품 `main` 병합: **평가 종료 전 금지**
>
> 새 10문항 본문: **이 Handoff에 포함하지 않으며 tracked repository에도 저장하지 않는다**
>
> 핵심 불변조건: **D / A6 / AO 모두 기존 정확성 계약과 §7.2 validator를 그대로 통과해야 한다**

> 현재 checkpoint: **`M6D_BLIND_REVIEW_VALIDATED`**
>
> Phase A 산출물: `logs/m6d-baseline-reanalysis.json`, `docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md`
>
> Phase B 산출물: `docs/CASE_FINDER_M6D_RPM_PACER.md`, `test/m6d-rpm-pacer.js`
>
> Phase C 산출물: `logs/m6d-private-holdout-runs.jsonl`, `logs/m6d-private-holdout-run-summary.json`, `logs/m6d-private-holdout-arm-comparison.json`
>
> Phase D 산출물: `docs/CASE_FINDER_M6D_PRIVATE_BLIND_REVIEW_INSTRUCTIONS.md`, `test/private/m6d-holdout/blind_packet.json`, `test/private/m6d-holdout/unmask_key.json`
>
> Phase E 입력: `test/private/m6d-holdout/blind_review_scores.jsonl` (44/44 schema PASS)
>
> Phase F 산출물: `docs/CASE_FINDER_FINAL_REPORT_M6D.md`, `logs/m6d-private-holdout-review-validation.json`, `logs/m6d-private-holdout-arm-comparison.json`
>
> terminal marker: **`M6D_D_RETAINED`**

---

# 0. 목적

M6C screening은 현재 30문항 × D/A6/AO = 90개 case-arm record로 완료되어 있다.

기준 보고서가 기록한 1회 screening 결과는 다음과 같다.

```text
D
- final selection recall: 0.522
- avg Gemini requests: 2.00

A6
- candidate recall: 0.283
- raw agent selection recall: 0.294
- final selection recall: 0.478
- avg Gemini requests: 4.42

AO
- candidate recall: 0.370
- raw agent selection recall: 0.438
- final selection recall: 0.565
- avg Gemini requests: 4.89
```

이 수치는 AO가 유망하다는 신호를 주지만 최종 제품 선택 근거로는 부족하다.

현재 미해결 항목:

```text
1. 기존 90건 aggregate가 natural/direct 질문을 섞어 계산한 부분을 다시 분리할 필요가 있다.
2. "protocol PASS"와 §7.2 실존검증 통과율을 분리해야 한다.
3. arm별 Gemini request 평균 외 median / p90 / max / 일일 처리량이 필요하다.
4. A6 → AO 추가 quota가 실제로 얼마의 recall 개선을 사는지 계산해야 한다.
5. 기존 golden은 반복적인 개발·진단 과정에서 이미 많이 사용되었다.
6. 실제 새로운 질문에서 D/A6/AO가 어떤 판례까지 접근하는지 독립 판정이 필요하다.
7. AO run 중 RPM limit으로 종료된 사례가 있었으므로 RPM 자체가 horizon을 자르는 문제를 제거해야 한다.
```

M6D는 이 일곱 항목만 해결한다.

---

# 1. 이번 단계의 범위

M6D는 세 부분으로 구성한다.

```text
Phase A — 기존 M6C 90건 raw log 재정산
Phase B — Gemini RPM limiter: fail → wait pacing 교정
Phase C — 새로운 private 10문항 D/A6/AO 실행
Phase D — 외부 판정자(Sol)용 blind packet 생성
Phase E — 판정 결과 unmask + 품질/quota 종합 비교
```

금지:

```text
새 ranking heuristic
새 query template
A8/A10/A12 등 새 호출상한 arm
새 model arm
새 MCP version arm
golden 정답 수정
AO 전용 검색 프롬프트
validator 완화
```

---

# 2. 작업 격리

현재 `Agentic_diagnose` HEAD를 읽기 전용 기준점으로 기록한다.

```text
M6D_ENTRY_SHA=df28007c52cd48fdb8fd5066ee4bdf209a42b0ff
```

권장:

```bash
git switch -c m6d-private-holdout-blind-eval
```

실험 종료 전 `main`으로 병합하지 않는다.

기존 M6C 산출물은 수정하지 않는다.

특히 다음 raw log는 read-only 입력이다.

```text
logs/m6c-screening-clean2-2026-08-11.jsonl
logs/m6c-screening-clean2-tail2-2026-08-11.jsonl
logs/m6c-screening-session2-tail-2026-08-11.jsonl
```

기존 `docs/CASE_FINDER_FINAL_REPORT_M6C.md`도 덮어쓰지 않는다.

---

# 3. Phase A — 기존 90건 독립 재산출

새 스크립트 권장:

```text
test/m6d-reanalyze.js
```

출력:

```text
logs/m6d-baseline-reanalysis.json
docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md
```

## 3.1 입력 무결성

세 raw log를 병합하고 다음을 검증한다.

```text
총 record = 90
고유 (case_id, arm) = 90
D = 30
A6 = 30
AO = 30
duplicate = 0
```

불일치 시 재산출 중단:

```text
M6D_BASELINE_INPUT_INVALID
```

## 3.2 평가 집단 분리

최소 다음 세 집단을 별도로 계산한다.

```text
ALL
NATURAL_ONLY
DIRECT_ONLY
```

가능하면 golden 메타데이터에 따라:

```text
TRAP / EMPTY_GOLD
```

도 별도 표시한다.

**A6 ↔ AO retrieval 비교의 primary population은 `NATURAL_ONLY`다.**

Route B 직접 사건번호 조회를 candidate-recall 평균에 섞지 않는다.

## 3.3 protocol PASS와 validator 성공 분리

기존 runner의 `PASS/FAIL`에는 `expected_case_not_in_output`도 포함될 수 있다.

따라서 다음을 별도 산출한다.

```text
golden_protocol_pass_rate
verified_nonempty_output_rate
verified_item_rate
```

`verified_nonempty_output_rate`는 비어 있지 않은 최종 결과에서 모든 item.status가 `verified`인 비율이다.

보고서에 다음을 명시한다.

```text
verified output ≠ golden recall
```

---

# 4. Phase A 필수 recall 지표

`NATURAL_ONLY`, 기대 사건번호가 존재하는 문항만 primary denominator로 사용한다.

arm별:

```text
candidate_gold_recall_mean
raw_agent_selection_recall_mean   # A6/AO only
final_selection_recall_mean
candidate_any_hit_rate
raw_selection_any_hit_rate        # A6/AO only
final_selection_any_hit_rate
```

mean recall과 question hit rate를 함께 기록한다.

---

# 5. Phase A Gemini quota 재산출

arm별 `NATURAL_ONLY` 기준:

```text
total_gemini_requests
avg_gemini_requests
median_gemini_requests
p90_gemini_requests
max_gemini_requests

total_mcp_calls
avg_mcp_calls

avg_elapsed_ms
median_elapsed_ms
p90_elapsed_ms
```

retry는 실제 Gemini request에 포함한다.

별도:

```text
total_retry_requests
retry_rate
```

---

# 6. 하루 처리 가능 질문 수

현재 앱 내부 RPD ceiling:

```text
450
```

reserve:

```text
30
```

arm별 계산:

```text
theoretical_daily_capacity
= floor(450 / avg_gemini_requests)

safe_daily_capacity
= floor(420 / avg_gemini_requests)
```

---

# 7. A6 → AO 한계효용 재산출

raw 90건에서 직접 계산한다.

```text
delta_avg_requests
= AO.avg_requests - A6.avg_requests

delta_final_recall
= AO.final_recall - A6.final_recall

delta_candidate_recall
= AO.candidate_recall - A6.candidate_recall
```

질문 단위:

```text
AO만 final gold hit 성공
A6만 final gold hit 성공
둘 다 성공
둘 다 실패
```

건수를 계산한다.

추가 gold question 1건당 요청 비용:

```text
extra_gold_questions
= count(AO hit && !A6 hit)

extra_requests_total
= AO total requests - A6 total requests

extra_requests_per_added_gold_question
= extra_requests_total / extra_gold_questions
```

`extra_gold_questions <= 0`이면 N/A.

---

# 8. AO 호출별 한계효용

기존 `agent_events`를 사용한다.

AO에서 Gemini request index 기준 누적:

```text
<= 2
<= 4
<= 6
<= 8
<= 10
<= 12
> 12
```

각 구간에서:

```text
new provider count
gold first-seen count
gold final-selected question count
```

를 계산한다.

---

# 9. Stop reason 재산출

A6/AO 각각:

```text
MODEL_FINAL
QUESTION_CALL_LIMIT
NO_NEW_EVIDENCE
RPM_LIMIT_STOP
RPD_RESERVE_STOP
RPD_LIMIT_STOP
SAFETY_WATCHDOG_STOP
ERROR
OTHER
```

특히 `RPM_LIMIT_STOP`이 존재했던 run의:

```text
case_id
arm
gemini_requests
retrieval state
fallback state
```

를 별도 표로 남긴다.

---

# 10. Checkpoint A

Phase A 완료 후 보고:

```text
M6D_BASELINE_REANALYSIS_COMPLETE

entry SHA
90/90 integrity
ALL / NATURAL / DIRECT population sizes
verified output rate
candidate/final recall
D/A6/AO request avg/median/p90/max
safe daily capacity
A6→AO delta
stop reason distribution
```

여기까지는 외부 호출 0회다.

---

# 11. Phase B — RPM fail을 wait pacing으로 변경

현재 문제:

```text
최근 60초 Gemini call >= RPM 13
→ GeminiLimitExceededError("분당 한도")
→ agent run 종료 또는 fallback
```

이는 AO의 검색 horizon을 quota 속도 제한이 잘라낼 수 있다.

M6D에서는 RPM을 **종료 조건이 아니라 scheduling 조건**으로 바꾼다.

---

# 12. RPM pacer 요구사항

RPD와 RPM의 의미를 분리한다.

```text
RPM full     => WAIT
RPD full     => THROW
RPD reserve  => THROW
```

---

# 13. write lock 안에서 sleep 금지

다음처럼 구현하지 않는다.

```js
withWriteLock(async () => {
  await sleep(30_000);
})
```

권장 구조:

```text
1. 짧은 write lock 진입
2. usage 읽기
3. RPD hard-stop 검사
4. RPM slot 있으면 timestamp reserve 후 return
5. slot 없으면 waitMs 계산
6. lock 해제
7. sleep(waitMs)
8. 다시 1번
```

---

# 14. RPM safety margin

rolling 60초 window 경계 오차 방지를 위해:

```text
RPM_WAIT_MARGIN_MS = 250~500ms
```

범위에서 하나를 고정한다.

```text
waitMs
= oldestRecentCall + 60_000 - now + margin
```

---

# 15. Gemini pacing telemetry

모든 arm에서 기록:

```text
gemini_rpm_wait_events
gemini_rpm_wait_ms
```

AO만이 아니라 D/A6에도 동일 pacer를 적용한다.

A6와 AO의 차이는 질문당 6회 상한뿐이어야 한다.

---

# 16. Provider 429

자체 RPM pacer를 통과했는데도 Gemini provider가 429를 반환할 수 있다.

기존 1회 retry 정책은 유지한다.

retry 전에도 동일 RPM pacer를 다시 통과한다.

429 retry도 Gemini request 1회로 quota accounting한다.

---

# 17. MCP를 Gemini RPM 조절기로 사용하지 않는다

금지:

```text
Gemini RPM을 늦추기 위해 MCP 결과를 일부러 sleep 후 반환
```

Gemini scheduling과 MCP latency를 섞지 않는다.

---

# 18. Phase B 필수 테스트

```text
test_rpm_full_waits_instead_of_throwing
test_rpm_wait_retries_after_window_opens
test_rpd_limit_still_throws
test_rpd_reserve_still_throws
test_wait_does_not_hold_usage_write_lock
test_retry_passes_rpm_pacer_again
test_retry_counts_as_gemini_request
test_rpm_wait_ms_is_recorded
test_rpm_wait_event_count_is_recorded
test_a6_question_limit_still_six
test_ao_has_no_fixed_question_limit
```

Checkpoint:

```text
M6D_RPM_PACER_READY
```

실제 holdout 실행 전 `npm run check` PASS 필수.

---

# 19. Phase C — 새로운 10문항 private holdout

정확히 10문항을 사용한다.

**이 문서에 질문 본문을 추가하지 않는다.**

Codex가 질문을 생성하지 않는다.

사용자가 별도로 제공한 질문만 사용한다.

ID:

```text
MH01
MH02
MH03
MH04
MH05
MH06
MH07
MH08
MH09
MH10
```

---

# 20. Private question handling

질문 본문은 tracked repository에 저장하지 않는다.

권장 private 경로:

```text
test/private/m6d-holdout/questions.json
```

필요하면 `.gitignore`에:

```text
test/private/
```

를 추가한다.

실행 전:

```bash
git check-ignore test/private/m6d-holdout/questions.json
```

PASS 확인.

tracked metadata에는 다음만 허용:

```text
question_id
sha256
char_count
```

질문을 받은 즉시 10개 hash를 freeze하고 실행 후 수정하지 않는다.

---

# 21. Holdout contamination 금지

금지:

```text
질문별 expected case number 사전 작성
질문별 검색어 사전 작성
질문별 expected law / issue answer 코드 삽입
arm별 prompt 조정
첫 실행 결과를 보고 질문 수정
한 arm의 검색어를 다른 arm에 전달
```

---

# 22. Holdout 실행

각 질문:

```text
D 1회
A6 1회
AO 1회
```

총 30 run.

초기 단계에서 3-repeat를 하지 않는다.

---

# 23. Arm 실행 순서

시간/quota bias 완화를 위해 rotate한다.

```text
MH01: D  → A6 → AO
MH02: A6 → AO → D
MH03: AO → D  → A6
MH04: D  → A6 → AO
...
```

같은 질문의 세 arm은 가능하면 인접 실행한다.

---

# 24. Holdout 실행 전 quota 보고

외부 호출 전:

```text
current local RPD usage
external/provider RPD known value if user supplied
reserve
RPM limit
planned 30 runs
```

를 보고한다.

기존 평균으로 예상 요청량을 계산할 수 있지만 AO를 hard cap하지 않는다.

---

# 25. Holdout 기록

각 run마다:

```text
question_id
question_sha256
arm

raw_agent_candidate_set
raw_agent_selection
fallback_candidate_set
final_product_output

final verified provider/case IDs

gemini_requests
gemini_retry_requests
gemini_input_tokens
gemini_output_tokens

gemini_rpm_wait_events
gemini_rpm_wait_ms

mcp_calls_total
mcp_search_calls
mcp_detail_calls

elapsed_ms
agent_stop_reason
agent_error_reason
fallback_used
```

---

# 26. Holdout 정확성 hard gate

모든 non-empty output은 기존 validator를 통과해야 한다.

하나라도 검증되지 않은 item이 렌더링되면:

```text
M6D_PROTOCOL_INVALID
```

이며 품질 비교를 제품 결정으로 승격하지 않는다.

---

# 27. RPM 판정

RPM pacer 적용 후 holdout에서:

```text
RPM_LIMIT_STOP
```

은 정상적으로 발생하면 안 된다.

```text
RPM wait > 0       => 정상 pacing
RPM_LIMIT_STOP > 0 => pacer defect / protocol issue
```

---

# 28. Phase D — blind packet

Codex는 관련성을 스스로 판정하지 않는다.

외부 판정자에게 넘길 packet만 만든다.

권장:

```text
test/private/m6d-holdout/blind_packet.json
test/private/m6d-holdout/unmask_key.json
```

둘 다 untracked.

---

# 29. Blind sample pool

질문별 세 arm의 **최종 verified selected 판례**를 합집합으로 만든다.

동일 `(question_id, provider_id)`는 한 번만 review한다.

packet에는:

```text
sample_id
question_id
question_text
provider_id
source_locator
```

만 넣는다.

---

# 30. Blind packet에서 숨길 것

외부 판정자에게 다음을 노출하지 않는다.

```text
arm
session/run ID
검색어
Gemini 요청 수
MCP 호출 수
fallback 여부
순위
어느 arm만 찾았는지
기존 golden 기대값
M6C 결과
```

unmask key에만:

```text
sample_id
question_id
provider_id
arms[]
rank_by_arm
```

를 저장한다.

---

# 31. 외부 판정자

권장 판정자:

```text
Sol
```

Codex가 Sol 판정을 흉내내거나 대신 수행하지 않는다.

절차:

```text
1. Codex가 blind packet 생성
2. Checkpoint에서 중단
3. 사용자가 packet을 외부 판정자에게 전달
4. 판정 완료 JSONL을 working tree로 돌려놓음
5. Codex가 schema validation 후 unmask
```

---

# 32. Blind relevance schema

외부 판정자는 각 sample의 법령센터 원문을 독립 확인한다.

relevance:

```text
DIRECT
STRONG_SUPPORT
WEAK_SUPPORT
IRRELEVANT
UNRESOLVED
```

추가 필드:

```text
issue_axes[]
quote_support = YES | NO | UNRESOLVED
limitation_needed = YES | NO | UNRESOLVED
```

---

# 33. "얼마나 접근했는가" 측정

unmask 후 질문별 arm마다 계산한다.

```text
best_relevance_tier
usable_count
broad_usable_count
irrelevant_count
relative_axis_coverage
```

정의:

```text
usable_count
= DIRECT + STRONG_SUPPORT

broad_usable_count
= DIRECT + STRONG_SUPPORT + WEAK_SUPPORT
```

질문별 전체 blind pool에서 확인된 relevant issue-axis union을 denominator로 사용한다.

```text
relative_axis_coverage
=
arm issue-axis union
/
question blind-pool relevant-axis union
```

denominator 0이면 N/A.

---

# 34. Question-level arm comparison

각 질문에서 다음 순서로 비교한다.

```text
1. best_relevance_tier
2. relative_axis_coverage
3. usable_count
4. broad_usable_count
5. 낮은 irrelevant_count
6. 동률이면 낮은 Gemini requests
```

질문별:

```text
D win
A6 win
AO win
tie
```

를 기록한다.

10문항으로 통계적 유의성을 과장하지 않는다.

---

# 35. Quota-quality 종합

arm별 새 holdout:

```text
avg_gemini_requests
median
p90
max

avg_rpm_wait_ms

DIRECT sample count
STRONG_SUPPORT count
usable count
question-level DIRECT-hit count
mean relative_axis_coverage
irrelevant rate
```

---

# 36. A6 → AO 새 holdout 한계효용

계산:

```text
delta_avg_requests
delta_direct_hit_questions
delta_usable_samples
delta_axis_coverage
```

가능하면:

```text
extra_requests_per_added_direct_question
extra_requests_per_added_usable_sample
```

분모 <= 0이면 N/A.

---

# 37. 기존 golden과 새 holdout을 섞지 않는다

최종 보고서에는 두 evidence block을 별도로 유지한다.

```text
Evidence A — 기존 M6C 30-question golden reanalysis
Evidence B — 새 M6D 10-question private blind holdout
```

두 값을 단순 평균해 하나의 overall score로 만들지 않는다.

---

# 38. Blind review result file

외부 판정 결과 권장 형식:

```json
{
  "sample_id": "MH01-S001",
  "question_id": "MH01",
  "provider_id": "123456",
  "relevance": "DIRECT",
  "issue_axes": ["..."],
  "quote_support": "YES",
  "limitation_needed": "YES"
}
```

권장 경로:

```text
test/private/m6d-holdout/blind_review_scores.jsonl
```

---

# 39. Review schema validation

Codex는 판정 내용의 법적 타당성을 재판정하지 않는다.

검사만 한다.

```text
모든 sample_id 정확히 1회
누락 0
중복 0
알 수 없는 sample 0
enum strict
issue_axes array
provider ID match
```

실패 시:

```text
M6D_REVIEW_SCHEMA_INVALID
```

---

# 40. 최종 tracked 산출물

권장:

```text
docs/CASE_FINDER_FINAL_REPORT_M6D.md

logs/m6d-baseline-reanalysis.json
logs/m6d-private-holdout-run-summary.json
logs/m6d-private-holdout-arm-comparison.json
```

tracked 파일에는 private question text를 넣지 않는다.

질문은 MH01~MH10 + hash로만 식별한다.

---

# 41. Final report 필수 표

## Table A — 기존 90건 재산출

```text
D / A6 / AO
NATURAL_ONLY recall
gold hit rate
verified output rate
avg/median/p90/max Gemini requests
safe daily capacity
stop reason
fallback rate
```

## Table B — 새 10문항 blind quality

```text
D / A6 / AO
question wins
DIRECT-hit questions
usable selected count
relative issue-axis coverage
irrelevant rate
```

## Table C — 새 10문항 quota

```text
D / A6 / AO
avg/median/p90/max Gemini requests
RPM wait events
RPM wait ms
MCP calls
elapsed time
safe daily capacity estimate
```

## Table D — A6 → AO marginal utility

```text
additional requests
additional DIRECT-hit questions
additional usable samples
axis-coverage delta
extra requests per added DIRECT question
extra requests per added usable sample
```

---

# 42. 제품 의사결정 규칙

## AO 우선 후보

```text
validator hard gate = PASS
private holdout에서 AO가 A6보다 관련성/coverage에서 반복 우위
AO quota 증가가 운영 가능한 범위
RPM stop = 0
```

이면:

```text
M6D_AO_PRODUCT_CANDIDATE
```

## AO rescue 후보

AO가 품질에서 유의미하게 우수하지만 safe daily capacity 또는 long-tail request가 지나치게 크면:

```text
M6D_AO_RESCUE_CANDIDATE
```

## A6 유지

```text
A6 ≈ AO quality
AO quota > A6
```

이면:

```text
M6D_A6_RETAINED
```

## D 유지

D가 새 holdout에서도 품질 동등 이상 + quota/latency 명확 우위이면:

```text
M6D_D_RETAINED
```

## Mixed

질문 유형에 따라 승자가 갈리고 단일 기본 arm을 정당화할 수 없으면:

```text
M6D_MIXED_RESULT
```

---

# 43. Terminal markers

정확히 하나:

```text
M6D_AO_PRODUCT_CANDIDATE
M6D_AO_RESCUE_CANDIDATE
M6D_A6_RETAINED
M6D_D_RETAINED
M6D_MIXED_RESULT
M6D_INCONCLUSIVE
M6D_PROTOCOL_INVALID
```

---

# 44. Checkpoints

## Checkpoint A

```text
M6D_BASELINE_REANALYSIS_COMPLETE
```

외부 호출 없음.

## Checkpoint B

```text
M6D_RPM_PACER_READY
```

테스트 결과와 diff 보고 후 holdout 실행 준비.

## Checkpoint C

```text
M6D_AWAITING_PRIVATE_HOLDOUT
```

사용자에게 10개 private 질문 입력이 필요한 시점.
Codex는 질문을 만들지 않는다.

## Checkpoint D

```text
M6D_PRIVATE_HOLDOUT_RUNS_COMPLETE
```

30 run 완료.

## Checkpoint E

```text
M6D_AWAITING_EXTERNAL_BLIND_REVIEW
```

blind packet 생성 후 반드시 중단.

## Checkpoint F

```text
M6D_BLIND_REVIEW_VALIDATED
```

외부 판정 결과 수신 후에만 unmask/final report 수행.

---

# 45. Stop-loss

M6D 결과가 애매하더라도 자동으로 다음을 만들지 않는다.

```text
새 10문항 추가
20문항 추가
AO8 / AO10 / AO12
prompt 비교
ranking 비교
model 비교
```

M6D는 현재 D / A6 / AO 3개 후보의 새 질문 일반화 성능 + quota 효율만 판정한다.

새 설계가 필요하면 M6D 종료 후 사람이 별도로 승인한다.

---

# 46. 완료 정의

```text
[ ] 기존 90건 raw log에서 recall/quota 재산출
[ ] NATURAL_ONLY 분리
[ ] protocol PASS와 validator verified rate 분리
[ ] request avg/median/p90/max 산출
[ ] safe daily capacity 산출
[ ] A6→AO marginal quota 계산
[ ] AO request-index marginal gain 계산
[ ] RPM fail→wait pacer 구현 및 테스트
[ ] RPD/reserve hard stop 유지
[ ] 새 10문항 hash freeze
[ ] 질문 본문 untracked 확인
[ ] D/A6/AO 30 run 완료
[ ] RPM_LIMIT_STOP 0 확인
[ ] 모든 non-empty output validator PASS
[ ] blind packet 생성
[ ] arm/session/quota 정보 masking 확인
[ ] 외부 Sol 판정 완료
[ ] review schema 검증
[ ] unmask 후 relevance/coverage/quota 비교
[ ] 최종 terminal 1개 기록
[ ] 제품 main 미변경
```

---

# 47. 최종 원칙

이번 단계에서 묻는 질문은 두 개다.

> **새로운 질문에서도 AO가 실제로 더 좋은 판례까지 접근하는가?**

그리고:

> **그 추가 접근을 얻기 위해 Gemini quota를 얼마나 더 지불해야 하는가?**

검색 자유도와 검증 자유도를 혼동하지 않는다.

**D / A6 / AO 중 어느 arm이 이기더라도 §7.2 validator는 유지한다.**

RPM은 검색 실패 사유가 아니라 속도 조절 대상으로 처리한다.

RPD는 실제 일일 자원 한계이므로 hard stop으로 유지한다.

새 holdout 질문 본문은 평가가 끝날 때까지 개발 코드와 Handoff에 노출하지 않는다.
