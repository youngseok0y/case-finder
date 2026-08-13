# Case Finder M9 Blind-30 최종 보고서

## 결론

검증된 30문항·3-arm·90-record 비교에서 Luna Native가 reviewer quality comparator 기준 가장 많은 question-level win을 기록했다.

| arm | question wins | ties | DIRECT-hit questions | usable samples | broad usable samples | irrelevant rate | relative axis coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
| Gemini D | 6 | 5 공동 | 13/30 | 37 | 47 | 28.4% | 0.682 |
| Gemini A6 | 5 | 5 공동 | 18/30 | 28 | 41 | 10.9% | 0.477 |
| Luna Native | 14 | 5 공동 | 19/30 | 46 | 62 | 4.6% | 0.682 |

Question-level comparator는 `best relevance tier → relative issue-axis coverage → usable count → broad usable count → 낮은 irrelevant count` 순서의 결정론적 비교다. Relevance tier는 `DIRECT > STRONG_SUPPORT > WEAK_SUPPORT > IRRELEVANT > UNRESOLVED`이며, 동률은 동률로 기록했다.

## 검증 범위

- 질문: 30개 (`B30-01`–`B30-30`)
- 실행: Gemini D 30, Gemini A6 30, Luna Native 30
- 결합 reviewer samples: 152개
- reviewer labels: 152/152
- sealed unmask entries: 152개
- label 충돌: 0건
- result contract/pin 실패: 0건
- 모든 arm `output_valid`: 30/30

기존 D/A6 packet의 107개 sample과 corrected Luna packet의 65개 sample을 `(question_id, normalized provider case identity)`로 결합했다. 두 packet의 overlap은 20개이며, 최종 packet에는 Luna-only 신규 sample 45개가 추가됐다.

## Reviewer label 분포

| label | count |
|---|---:|
| DIRECT | 65 |
| STRONG_SUPPORT | 21 |
| WEAK_SUPPORT | 38 |
| IRRELEVANT | 27 |
| UNRESOLVED | 1 |

`UNRESOLVED` 1건은 기존 D/A6 packet의 S-052이며, source access 문제로 reviewer가 보류한 항목이다. 이 항목은 usable count에 포함하지 않았다.

## Arm별 실행·증거 품질

| metric | Gemini D | Gemini A6 | Luna Native |
|---|---:|---:|---:|
| reviewed samples | 67 | 46 | 65 |
| DIRECT samples | 26 | 23 | 38 |
| STRONG_SUPPORT samples | 11 | 5 | 8 |
| WEAK_SUPPORT samples | 10 | 13 | 16 |
| usable (`DIRECT + STRONG_SUPPORT`) | 37 | 28 | 46 |
| broad usable | 47 | 41 | 62 |
| DIRECT-hit questions | 13 | 18 | 19 |
| verified items | 66/67 | 46/46 | 65/65 |
| empty result records | 1 | 1 | 4 |

Luna는 reviewer sample 수가 가장 많았고, usable/broad usable 수와 낮은 irrelevant rate에서 우세했다. Gemini A6는 D보다 DIRECT-hit question 수가 많았지만, STRONG_SUPPORT와 broad usable을 포함한 전체 evidence 폭은 Luna와 D보다 낮았다.

## Protocol·quota·runtime

### Gemini D

- Gemini requests: 59회, 평균 1.97회/question
- retry: 0회
- input/output tokens: 126,072 / 6,856
- execution pin: `gemini_d`

### Gemini A6

- Gemini requests: 123회, 평균 4.10회/question
- retry: 0회
- RPM wait: 1회 / 11,193ms
- input/output tokens: 279,746 / 5,203
- execution pin: `gemini_a6`

### Luna Native

- Codex native sessions: 30개
- Gemini requests: 0회
- legal MCP calls: 368회 (`search` 178, `detail` 190)
- verified items: 65/65
- model protocol clean: 17/30
- selection repaired: 13/30
- forbidden tool contamination: 0건
- execution pin: `luna_native`
- model: `gpt-5.6-luna`, reasoning: `medium`

Luna의 protocol repair 13건은 결과 자체를 invalid 처리한 것이 아니라 native final-selection gate가 형식/grounding 문제를 repair한 기록이다. 최종 출력은 30/30 `output_valid`였다.

실행 artifact에는 AO native의 elapsed time이 공통 contract로 전파되지 않아 Luna latency는 보고하지 않는다. 이는 이번 quality 결론에 사용하지 않았다.

## Items 직렬화 결함과 수정

초기 full-run에서 Luna의 native AO 결과는 `selected`와 ledger evidence를 보유했지만 `items` 배열을 만들지 않았다. 이후 `toResultContract()`가 빈 `items` 배열을 적용했고, packet builder는 `result.items`만 순회했기 때문에 Luna sample이 전부 누락됐다.

수정 후 Luna adapter가 adapter-scoped EvidenceLedger에서 검증된 selected case를 `items`로 복원하고, provider ID·raw case identity·공식 Law.go.kr JSON/detail locator를 보존하도록 했다. 수정된 Luna-only rerun은 30 records, 65 items, 65 samples를 생성했고 evidence/link 누락은 0건이었다.

상세 분석은 [M9 Luna items serialization analysis](./CASE_FINDER_M9_LUNA_ITEMS_SERIALIZATION_ANALYSIS.md)에 기록했다.

## 산출물

Private artifact는 `test/private/m9-blind30/` 아래에 보관되며 Git 추적 대상이 아니다.

- `luna-rerun.json`: 수정 후 Luna 30-run
- `luna_blind_packet.json`: Luna-only review packet
- `M9_LUNA_LABELS.json`: Luna-only reviewer labels
- `blind_packet_combined.json`: 최종 3-arm 결합 packet
- `M9_BLIND30_COMBINED_LABELS.json`: identity-merged labels
- `unmask_combined.json`: 최종 3-arm unmask 결과

## QA

- `npm run check` 통과
- `npm run m9:test`: 20/20 통과
- `npm run m8:test`: 16/16 통과
- `git diff --check` 통과
- Luna-only rerun: 30/30 records
- combined unmask: 152/152 labels

이번 보고서는 reviewer labels와 corrected Luna rerun을 반영한 M9 결과이며, private question text·run trace·unmask artifact는 repository에 추가하지 않는다.
