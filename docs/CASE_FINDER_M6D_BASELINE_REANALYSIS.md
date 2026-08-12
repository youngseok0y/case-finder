# Case Finder M6D Phase A 기준선 재집계 보고서

## 상태

`M6D_BASELINE_REANALYSIS_COMPLETE`

- 기준 SHA: `df28007c52cd48fdb8fd5066ee4bdf209a42b0ff`
- 입력: 기존 M6C raw log 3개, 총 90건
- 무결성: PASS (고유 case-arm 90건, 중복 0건)
- 외부 호출: 0회
- 기존 M6C raw log와 M6C 최종 보고서는 수정하지 않음

## 입력 무결성과 모집단

| 항목 | 값 |
| 총 record | 90 |
| 고유 (case_id, arm) | 90 |
| D / A6 / AO | 30 / 30 / 30 |
| duplicate | 0 |
| ALL / NATURAL_ONLY / DIRECT_ONLY | 90 / 57 / 33 |
| EMPTY_GOLD | 21 |

## Table A — protocol과 validator 분리

`verified output ≠ golden recall`이다. protocol PASS는 golden 기대값 포함 여부를 포함하며, verified 지표는 최종 출력 원소의 상태만 측정한다. D arm은 기존 raw log에 `final_product_output`이 없어 runner의 `verified_item_rate` proxy를 별도로 사용했다.

| arm | population | protocol PASS | verified non-empty output | verified item rate | fallback rate (natural) |
| D | ALL 30 | 19/30 (63.3%) | 24/24 (100.0%) | 100.0% (runner_verified_item_rate_proxy) | 0.0% |
| A6 | ALL 30 | 19/30 (63.3%) | 25/25 (100.0%) | 100.0% (mixed) | 26.3% |
| AO | ALL 30 | 21/30 (70.0%) | 25/25 (100.0%) | 100.0% (mixed) | 10.5% |

## Table B — NATURAL_ONLY recall (expected gold가 있는 문항)

| arm | denominator | candidate mean / hit | raw selection mean / hit | final mean / hit |
| D | 17 | 0.353 / 35.3% | N/A / N/A | 0.353 / 35.3% |
| A6 | 17 | 0.382 / 41.2% | 0.294 / 35.3% | 0.294 / 35.3% |
| AO | 17 | 0.5 / 52.9% | 0.412 / 47.1% | 0.412 / 47.1% |

## Table C — NATURAL_ONLY quota와 latency

| arm | total req | avg | median | p90 | max | retry | MCP avg | elapsed avg/median/p90 ms | safe daily |
| D | 38 | 2 | 2 | 2 | 2 | 0 (0.0%) | 43.947 | 9889.579/9148/12557.2 | 210 |
| A6 | 84 | 4.421 | 4 | 6 | 6 | 0 (0.0%) | 3.684 | 9727.895/5944/9933.4 | 94 |
| AO | 93 | 4.895 | 4 | 7.8 | 13 | 0 (0.0%) | 3.947 | 7210/5897/10689.4 | 85 |

## Table D — A6 → AO 한계효용

| 지표 | 값 |
| 비교 모집단 | 17 |
| AO만 final gold hit | 2 |
| A6만 final gold hit | 0 |
| 둘 다 성공 / 둘 다 실패 | 6 / 9 |
| delta avg requests (AO-A6) | 0.47 |
| delta final recall | 0.118 |
| delta candidate recall | 0.118 |
| extra requests total | 8 |
| extra requests / added gold question | 4 |

## Table E — AO request-index 누적 관측

기존 `agent_events`에 provider ID가 없으므로 `newObservedCaseNumberCount`를 provider 관측의 대리값으로 산출했다.

| 누적 request | new observed case numbers | gold first-seen | gold final-selected questions |
| 2 | 169 | 11 | 0 |
| 4 | 252 | 11 | 7 |
| 6 | 252 | 11 | 7 |
| 8 | 252 | 11 | 7 |
| 10 | 253 | 11 | 7 |
| 12 | 259 | 11 | 8 |
| >12 | 0 | 0 | 0 |

## Table F — stop reason과 fallback

| arm | stop reason (NATURAL_ONLY) | fallback reason |
| A6 | {"QUESTION_CALL_LIMIT":4,"MODEL_FINAL":15} | {"ranked_fill":5} |
| AO | {"MODEL_FINAL":18,"RPD_RESERVE_STOP":1} | {"ranked_fill":2} |

### RPM_LIMIT_STOP 별도 기록

- 해당 없음

## 해석과 다음 checkpoint

- 이 보고서는 기존 golden 30문항의 독립 재산출이며, 새로운 질문에 대한 일반화나 관련성의 블라인드 판정이 아니다.
- 직접조회는 Route B이므로 retrieval recall primary population에 섞지 않았다.
- validator 통과율과 golden 기대 판례 회수율은 별도 지표다.
- Phase B RPM pacer와 Phase C/D private holdout·blind packet 생성이 완료되었다. 현재는 외부 reviewer 판정 전 대기 중이며, private 질문 본문은 tracked 문서에 포함하지 않는다.

## 산출물

- `logs/m6d-baseline-reanalysis.json`
- `docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md`
- `test/m6d-reanalyze.js`
