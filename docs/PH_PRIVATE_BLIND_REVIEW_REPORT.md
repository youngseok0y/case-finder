# PH Private Blind Review Report

## 결론

상태: `PH_BLIND_REVIEW_VALIDATED`

PH01–PH30에 대한 외부 blind review score 117건을 검증하고 unmask했다. 사전에 정의한 question-level comparator 기준으로 D를 기본 arm으로 유지한다. A6와 AO는 이번 holdout에서 D를 대체할 근거가 부족하다.

이는 검색 결과의 쟁점 적합성에 대한 이번 reviewer 평가 결과이며, 개별 질문에 대한 법률 자문이나 법적 결론이 아니다.

## 검증

- packet: `PH_PRIVATE_BLIND_2026-08-12`
- 질문: 30개
- blind samples: 117개
- reviewer scores: 117개
- unmask key entries: 117개
- 누락: 0
- 중복: 0
- unknown sample: 0
- enum/shape 오류: 0
- provider mismatch: 0
- 실행 protocol: 90/90 PASS
- 실행 중 RPM/RPD hard stop: 0회

Reviewer labels는 변환 없이 사용했다. relevance 분포는 `DIRECT` 32, `STRONG_SUPPORT` 29, `WEAK_SUPPORT` 18, `UNRESOLVED` 20, `IRRELEVANT` 18이다.

## arm 비교

| 지표 | D | A6 | AO |
|---|---:|---:|---:|
| question-level wins | 15 | 8 | 2 |
| 동률을 제외한 승리 목록 | PH01, PH02, PH03, PH05, PH09, PH14, PH16, PH17, PH18, PH22, PH23, PH24, PH27, PH28, PH30 | PH07, PH08, PH10, PH11, PH12, PH15, PH20, PH26 | PH19, PH21 |
| 동률 | PH04, PH06, PH13, PH25, PH29 | PH04, PH06, PH13, PH25, PH29 | PH04, PH06, PH13, PH25, PH29 |
| direct-hit questions | 12 | 15 | 13 |
| strong-support-hit questions | 13 | 9 | 7 |
| usable selected samples | 35 | 29 | 23 |
| broad usable samples | 41 | 33 | 32 |
| direct samples | 18 | 19 | 16 |
| irrelevant rate | 0.125 | 0.104 | 0.156 |
| mean relative axis coverage | 0.603 | 0.547 | 0.552 |
| 평균 Gemini requests/run | 2.00 | 3.93 | 3.97 |

D는 direct-hit 문제 수만으로는 A6보다 낮지만, comparator가 우선하는 best relevance·쟁점 축 coverage·usable output·비용을 함께 적용했을 때 가장 많은 question-level wins를 기록했다. A6는 direct-hit 문제 수와 낮은 irrelevant rate에서 강점이 있으므로 후속 평가에서 별도 후보로 유지한다.

## A6 → AO marginal utility

- 추가 Gemini 요청: 총 1회, 평균 +0.033회/run
- direct-hit questions: 15 → 13, 2개 감소
- AO-only direct-hit questions: 1개
- usable selected samples: 29 → 23, 6개 감소
- AO-only usable samples: 9개
- mean relative axis coverage: 0.547 → 0.552, +0.005
- 추가 direct question 1개당 추가 요청: 1회

이번 결과에서는 AO의 open-ended 확장이 평균 비용을 거의 늘리지 않았지만, A6 대비 전체 품질 지표를 개선하지 못했다. 따라서 AO를 기본 경로로 승격하지 않는다.

## quota 및 pacing

- provider RPD 관측: 102/500 → 399/500
- Gemini 요청: 297회
- RPM wait events: 34회
- RPM wait time: 154,309ms
- local RPD limit: 450
- AO reserve: 30

## 산출물

- 실행 보고서: `docs/PH_PRIVATE_BLIND_RUN_REPORT.md`
- reviewer instructions: `docs/PH_PRIVATE_BLIND_REVIEW_INSTRUCTIONS.md`
- schema validation: `logs/ph-private-holdout-review-validation.json`
- unmasked comparison: `logs/ph-private-holdout-arm-comparison.json`
- private score file: `test/private/ph-holdout/blind_review_scores.jsonl`

private packet, score file, run log, unmask key는 `.gitignore` 정책에 따라 Git에 추가하지 않는다.
