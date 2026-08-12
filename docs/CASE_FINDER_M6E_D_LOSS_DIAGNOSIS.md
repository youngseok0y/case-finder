# M6E Phase A — D Loss Diagnosis

상태: `M6E_D_LOSS_DIAGNOSIS_COMPLETE`

다음 checkpoint: `M6E_USER_REVIEW_REQUIRED`

## 범위

PH private holdout의 기존 30개 D-run과 unmasked comparator만 오프라인으로 분석했다. 새 Gemini/MCP 검색 호출은 0회이며, PH 질문·packet·unmask key는 변경하지 않았다.

집단은 handoff 정의를 그대로 사용했다.

- `D_WIN`: PH01, PH02, PH03, PH05, PH09, PH14, PH16, PH17, PH18, PH22, PH23, PH24, PH27, PH28, PH30
- `A6_RESCUEABLE`: PH07, PH08, PH10, PH11, PH12, PH15, PH20, PH26
- `AO_ONLY_LOSS`: PH19, PH21
- `TIE`: PH04, PH06, PH13, PH25, PH29

## 관측 가능성

현재 PH D-run 기록에서 직접 확인할 수 있는 값은 최종 `selected` 수·direct/related 구성·verified 수·fallback 여부·Gemini 요청 수·MCP search/detail/total 호출 수·elapsed time이다.

다음 값은 보존되어 있지 않다.

- ranked fill 이전의 D raw selection
- D raw candidate list와 ranked candidate list
- `matchedKeywords` 및 검색 consensus
- rank score, rank margin, score 표준편차
- 후보 preview 존재 여부
- D Gemini plan의 keywords/domains/law_names와 query별 결과 분산

따라서 D record의 빈 `raw_agent_candidate_set`은 후보가 0개였다는 뜻이 아니라, D 내부 후보를 runner가 기록하지 않았다는 뜻이다. 아래 수치는 구현 gate에 바로 사용할 수 없는 사후 output proxy로 구분한다.

## 집단별 proxy summary

| 집단 | n | selected 평균/중앙값 | direct 평균/중앙값 | direct ratio 평균/중앙값 | verified 평균/중앙값 | MCP search 평균 | elapsed 평균(ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| D_WIN | 15 | 1.87 / 2 | 0.93 / 1 | 0.456 / 0.500 | 1.87 / 2 | 17.13 | 14,355 |
| A6_RESCUEABLE | 8 | 1.38 / 1 | 0.88 / 1 | 0.625 / 1.000 | 1.38 / 1 | 19.00 | 12,039 |
| AO_ONLY_LOSS | 2 | 2.00 / 2 | 0.50 / 0.5 | 0.167 / 0.167 | 2.00 / 2 | 20.50 | 11,089 |
| TIE | 5 | 2.60 / 2 | 0.60 / 0 | 0.200 / 0 | 2.00 / 2 | 15.80 | 12,640 |

모든 D-run은 Gemini 2회였고, 이 보존 기록상 fallback은 사용되지 않았다. A6_RESCUEABLE 집단은 D_WIN보다 최종 selected 수가 적은 경향이 보였지만, selected는 ranked fill 이후 값일 수 있어 “D가 raw selection에서 불확실하다고 판단했다”는 증거로 해석할 수 없다. direct ratio도 오히려 A6_RESCUEABLE 집단 평균이 높아 단순 direct 부재 신호는 분리력이 약하다.

## 회고용 gate 후보

아래는 구현 제안이 아니라, 현재 저장된 output proxy에 대한 retrospective 계산이다.

| 후보 | trigger | A6_RESCUEABLE recall | precision | D_WIN false trigger | TIE trigger | AO_ONLY_LOSS trigger |
|---|---:|---:|---:|---:|---:|---:|
| `selected_count <= 1` | 14 | 75.0% | 42.9% | 7 | 0 | 1 |
| `direct_count == 0` | 12 | 37.5% | 25.0% | 5 | 3 | 1 |
| `selected_count <= 1 AND direct_count == 0` | 8 | 25.0% | 25.0% | 5 | 0 | 1 |

`selected_count <= 1`이 현재 proxy 중에는 가장 높은 recall/precision을 보였지만, D_WIN false trigger가 7건이고 ranked fill 오염 가능성이 있다. 따라서 제품 gate로 승인하지 않는다.

## Phase A 판단

1. PH에서 D 패배 집단과 D 승리 집단 사이에 **실행 중 관측 가능한 공통 failure signal을 충분히 입증할 수 없다**.
2. 현재 proxy만으로는 deterministic gate의 precision이 낮고, D의 강점을 보존할 수 있는지 평가할 수 없다.
3. 별도 `evidence_state`를 추가해도 D raw selection/후보 trace가 없는 현재 evidence만으로는 threshold를 정당화할 수 없다.
4. 제품 코드 변경, DA6 구현, 새 private 20문항 생성·실행은 하지 않았다.

## 권장 선택

현재 단계의 권장안은 handoff의 사용자 리뷰 선택지 중 **C — gate 신호가 불충분하여 D-A6 구조 중단**에 가깝다. 다만 이 결론은 D 내부 trace 결측 때문에 보수적으로 내린 것이다. 사용자가 B를 선택한다면, 먼저 제품 동작을 바꾸기보다 D-run에 raw selection/candidate/ranking/plan trace를 보존하는 offline instrumentation을 승인해야 한다. 사용자가 A를 선택한다면 `selected_count <= 1`은 제품 gate가 아니라 명시적 위험이 큰 실험 후보로만 취급해야 한다.

## 산출물

- 분석 script: `test/m6e-d-loss-diagnosis.js`
- 분석 결과: `logs/m6e-d-loss-diagnosis.json`
- read-only source: `logs/ph-private-holdout-runs.jsonl`, `logs/ph-private-holdout-arm-comparison.json`

사용자 리뷰 전에는 Phase B 구현과 새 private 20문항 실행을 시작하지 않는다.
