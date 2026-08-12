# Case Finder M7 Codex Luna-medium Benchmark Report

작성일: 2026-08-12 KST

## Checkpoint

```text
M7_PROTOCOL_INVALID
M7_USER_REVIEW_REQUIRED
```

Phase B의 fresh golden 17 four-arm 실행은 완료했지만, L-AO 17문항 중 3문항에서 fallback이 발생했다. 따라서 이 결과는 품질 승격 판단이나 PH continuation의 근거로 사용하지 않는다.

## 실행 조건

- branch: `m7-codex-luna-medium-eval`
- baseline: `m6e-d-a6-conditional-rescue` @ `4f28d2f1a61c95ede457f19f118fb76eb3b7ce80`
- population: `test/golden.json`의 natural + expectedCaseNumbers 17문항
- arms: G-D, L-D, G-AO, L-AO
- run count: 17 x 4 = 68
- rotation: Q1 G-D -> L-D -> G-AO -> L-AO, question별 cyclic offset
- Codex: CLI `0.147.0-alpha.6.5`, ChatGPT login, `gpt-5.6-luna`, reasoning `medium`
- Codex workdir: `test/private/m7-codex-runtime/workdir/`
- Node: `v24.14.0`
- korean-law-mcp: `4.9.6`

## Arm 결과

| arm | runs | protocol pass | strict gold | rate | fallback | avg elapsed |
|---|---:|---:|---:|---:|---:|---:|
| G-D | 17 | 17 | 6 | 35.3% | 0 | 11.5s |
| L-D | 17 | 17 | 8 | 47.1% | 0 | 28.4s |
| G-AO | 17 | 17 | 8 | 47.1% | 0 | 8.3s |
| L-AO | 17 | 14 | 2 | 11.8% | 3 | 50.0s |

L-D는 G-D보다 strict gold가 +2였지만, L-AO는 G-AO보다 -6이고 protocol failure 3건이 있어 golden continuation gate를 통과하지 못한다.

## Token / cost

Luna arm의 exact CLI token event를 사용했다. `reasoning_tokens`는 output subset으로 취급해 이중 계산하지 않는다.

| arm | model invocations | input | cached input | output | reasoning | credits | current API-eq | handoff API-eq |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| L-D | 34 | 483,672 | 0 | 7,114 | 3,462 | 13.158900 | $0.105271 | $0.526356 |
| L-AO | 103 | 1,598,476 | 143,616 | 16,379 | 9,332 | 42.777790 | $0.342222 | $1.711112 |

Credit 계산은 final handoff의 `25 / 2.5 / 150` per 1M tokens를 사용했다. Current API-equivalent는 공식 GPT-5.6 Luna 문서의 `0.20 / 0.02 / 1.20` per 1M tokens를 별도 기록했다. handoff snapshot의 `1 / 0.10 / 6`도 비교용으로 보존했다.

## Protocol failures

1. `statute-medical-service-24-2 / L-AO`
   - stop: `NO_NEW_EVIDENCE`
   - fallback: `ranked_fill`
   - final verified items: 0
   - 원인 관찰: Codex가 `search_law`만 반복하고 판례 후보를 만들지 못함

2. `domain-constitutional-adultery / L-AO`
   - stop: `MODEL_FINAL`
   - fallback: `ranked_fill`
   - final verified items: 0

3. `domain-constitutional-alternative-service / L-AO`
   - stop: `MODEL_FINAL`
   - fallback: `ranked_fill`
   - final verified items: 0

단일 exact-query 재현에서는 간통 문항이 `2009헌바17`을 정상 검증한 경우도 확인되어, 위 실패를 deterministic adapter defect로 단정하지 않는다. 다만 fresh benchmark record 자체가 fallback을 포함하므로 protocol gate는 실패로 유지한다.

## 보류

- `M7_FOUR_ARM_GOLDEN_COMPLETE`로 승격하지 않음
- PH30 Luna D/AO 실행하지 않음
- blind review packet 생성하지 않음
- 제품 `main` 통합하지 않음
- `M7_LUNA_CLEAR_WIN`, `M7_LUNA_COST_QUALITY_TRADEOFF`, `M7_GEMINI_RETAINED` 중 하나를 최종 확정하지 않음

## Artifacts

- run log: `test/private/m7-codex-runtime/m7-four-arm-runs-rerun1.jsonl`
- machine summary: `test/private/m7-codex-runtime/m7-four-arm-summary-rerun1.json`
- partial first attempt: `test/private/m7-codex-runtime/m7-four-arm-runs.jsonl`

다음 작업은 사용자 검토 후 L-AO protocol failure를 별도 진단하거나, M7을 `M7_PROTOCOL_INVALID` 상태로 종료하는 것이다. 이 보고서의 68행은 재현 기록으로 보존하며, 실패 3행을 성공으로 대체하지 않는다.
