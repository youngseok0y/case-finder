# Case Finder M6D 최종 보고서

## Terminal

`M6D_D_RETAINED`

## Checkpoint

`M6D_BLIND_REVIEW_VALIDATED`

## 1. 범위와 검증 상태

- 사용자 제공 private 질문 10개: `MH01`–`MH10`
- 실행: D / A6 / AO 각 1회, 총 30 run
- private question hash: 실행 전 freeze
- 외부 reviewer blind sample: 44개
- review 결과: 44/44
- schema 누락 / 중복 / unknown sample / enum 오류 / provider ID 불일치: 모두 0
- 30개 run protocol PASS: 30/30
- 최종 출력 미검증 item: 0
- RPM_LIMIT_STOP: 0
- reviewer의 relevance 라벨은 Codex가 재판정하지 않고 그대로 집계했다.

초기 sandbox 네트워크 제한으로 발생한 부분 실행은 폐기했고, 아래 결과는 local RPD를 0으로 재설정한 뒤 승인된 네트워크 경로에서 완료한 최종 30 run만 포함한다.

## 2. Quota와 pacing

| 항목 | 값 |
|---|---:|
| provider context 시작값 | 0 / 500 |
| 앱 local RPD | 102 / 450 |
| RPM | 13 / rolling 60초 |
| RPM wait margin | 350ms |
| AO RPD reserve | 30 |
| 총 Gemini requests | 102 |
| 총 RPM wait events / ms | 18 / 72,293 |
| provider retry requests | 0 |

provider의 실제 일일 사용량은 이 로컬 실행에서 독립 조회할 수 없으므로, provider quota는 사용자가 제공한 시작 context로 기록하고 앱 local usage를 별도로 집계했다.

## 3. Evidence A — 기존 M6C 90건 재집계

이 표는 새 private holdout과 섞지 않은 기존 M6C 기준선이다. primary population은 `NATURAL_ONLY` 17문항이다.

| arm | candidate recall / hit | final recall / hit | verified output | Gemini avg / median / p90 / max | safe daily capacity |
|---|---:|---:|---:|---:|---:|
| D | 0.353 / 35.3% | 0.353 / 35.3% | 100.0% | 2 / 2 / 2 / 2 | 210 |
| A6 | 0.382 / 41.2% | 0.294 / 35.3% | 100.0% | 4.421 / 4 / 6 / 6 | 94 |
| AO | 0.500 / 52.9% | 0.412 / 47.1% | 100.0% | 4.895 / 4 / 7.8 / 13 | 85 |

기존 기준선의 상세 산출은 [`docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md`](./CASE_FINDER_M6D_BASELINE_REANALYSIS.md)에 있다.

## 4. Evidence B — private blind quality

`usable = DIRECT + STRONG_SUPPORT`, `broad usable = DIRECT + STRONG_SUPPORT + WEAK_SUPPORT`이다. relative axis coverage의 분모는 질문별 blind pool에서 reviewer가 relevant로 표시한 issue-axis 합집합이다.

| arm | question wins | DIRECT-hit questions | usable selected count | broad usable count | mean axis coverage | irrelevant rate |
|---|---:|---:|---:|---:|---:|---:|
| D | 6 | 3 | 11 | 14 | 0.445 | 12.5% |
| A6 | 3 | 3 | 8 | 15 | 0.409 | 16.7% |
| AO | 1 | 2 | 3 | 11 | 0.314 | 31.3% |

### 질문별 winner

| 질문 | winner |
|---|---|
| MH01 | AO |
| MH02 | D |
| MH03 | D |
| MH04 | A6 |
| MH05 | D* |
| MH06 | D |
| MH07 | D |
| MH08 | A6 |
| MH09 | A6 |
| MH10 | D |

`MH05`는 세 arm 모두 동일 판례를 `IRRELEVANT`로 평가받아 품질 지표가 동률이었고, 명세의 마지막 tie-break인 Gemini requests가 가장 낮은 D가 winner가 되었다.

## 5. Evidence B — private quota

| arm | avg / median / p90 / max requests | RPM wait events / ms | MCP total / avg | elapsed avg ms | safe daily capacity |
|---|---:|---:|---:|---:|---:|
| D | 2 / 2 / 2 / 2 | 1 / 1,385 | 468 / 46.8 | 14,217.4 | 210 |
| A6 | 4.3 / 4 / 6 / 6 | 6 / 29,762 | 36 / 3.6 | 9,736.1 | 97 |
| AO | 3.9 / 3.5 / 5.3 / 8 | 11 / 41,146 | 29 / 2.9 | 10,183.7 | 107 |

safe daily capacity는 local RPD 450에서 30 reserve를 제외한 420을 arm 평균 Gemini request로 나눈 보수적 추정치다.

## 6. A6 → AO marginal utility

| 지표 | 값 |
|---|---:|
| AO - A6 평균 requests | -0.4 |
| AO - A6 총 requests | -4 |
| DIRECT-hit questions | AO 2 vs A6 3, delta -1 |
| AO-only DIRECT-hit questions | 1 |
| usable selected count | AO 3 vs A6 8, delta -5 |
| AO-only usable samples | 2 |
| mean relative axis coverage delta | -0.095 |
| extra requests / added DIRECT question | N/A |
| extra requests / added usable sample | N/A |

AO는 이 holdout에서 A6보다 요청을 추가로 사용하지 않았고 오히려 총 4회 적게 사용했다. 따라서 “추가 요청당 비용”은 정의하지 않고 N/A로 표시했다. 그럼에도 AO의 DIRECT, usable count, coverage가 A6보다 낮아 추가 품질 효용은 관측되지 않았다.

## 7. 제품 판단

D를 retained 기본 arm으로 유지한다.

- 질문별 winner: D 6/10으로 가장 많음
- DIRECT-hit questions: D 3/10으로 A6와 동률, AO보다 많음
- usable selected count: D 11로 A6 8, AO 3보다 많음
- mean axis coverage: D 0.445로 A6 0.409, AO 0.314보다 높음
- irrelevant rate: D 12.5%로 A6 16.7%, AO 31.3%보다 낮음
- 평균 Gemini requests: D 2.0으로 가장 낮음
- RPM_LIMIT_STOP: 모든 arm 0

10문항 holdout은 통계적 유의성을 주장하기에 작으므로, 이 결과는 M6D 범위의 운영·제품 후보 판단으로 기록한다. A6와 AO 구현은 삭제하지 않으며, 현재 기본 모드 `PIPELINE_MODE=deterministic`만 유지한다.

## 8. 산출물과 후속 상태

- 기준선: [`docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md`](./CASE_FINDER_M6D_BASELINE_REANALYSIS.md)
- RPM pacer: [`docs/CASE_FINDER_M6D_RPM_PACER.md`](./CASE_FINDER_M6D_RPM_PACER.md)
- 실행 보고서: [`docs/CASE_FINDER_M6D_PRIVATE_HOLDOUT_RUN_REPORT.md`](./CASE_FINDER_M6D_PRIVATE_HOLDOUT_RUN_REPORT.md)
- reviewer Instructions: [`docs/CASE_FINDER_M6D_PRIVATE_BLIND_REVIEW_INSTRUCTIONS.md`](./CASE_FINDER_M6D_PRIVATE_BLIND_REVIEW_INSTRUCTIONS.md)
- schema validation: `logs/m6d-private-holdout-review-validation.json`
- unmask 비교 집계: `logs/m6d-private-holdout-arm-comparison.json`

M6D private question text, blind packet, unmask key, review scores는 `test/private/` 아래에 보관하며 tracked repository에서 제외한다. M6D는 `M6D_D_RETAINED`로 종료한다.
