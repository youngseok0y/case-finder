# M7 Codex Luna Medium Preflight

작성일: 2026-08-12

## 범위

- 실험 branch: `m7-codex-luna-medium-eval`
- baseline source: `m6e-d-a6-conditional-rescue` @ `4f28d2f1a61c95ede457f19f118fb76eb3b7ce80`
- isolated workdir: `test/private/m7-codex-runtime/workdir/`
- benchmark 대상: fresh golden 17 four-arm benchmark
- 이번 단계: Phase A preflight만 수행. Phase B 68회 benchmark와 PH는 시작하지 않음.

## Preflight 결과

| gate | result | evidence |
|---|---|---|
| Codex CLI version | PASS | `codex-cli 0.147.0-alpha.6.5` (required `>= 0.144.0`) |
| auth mode | PASS | 실제 사용자 환경의 `codex login status`: `Logged in using ChatGPT`; doctor의 stored auth mode: `chatgpt` |
| effective model | PASS | session metadata `model=gpt-5.6-luna` |
| effective reasoning effort | PASS | session `turn_context`: `reasoning_effort=medium`, `effort=medium` |
| machine-readable token source | PASS | CLI JSONL `turn.completed.usage` 및 session `token_count` event |
| structured output | PASS | `--output-schema` 검증 후 exact JSON 응답 |
| isolated workdir | PASS | smoke session cwd가 `test/private/m7-codex-runtime/workdir/`; workdir 변경 없음 |
| direct MCP access | PASS for smoke | `--ignore-user-config`, read-only sandbox, empty isolated workdir, no MCP/tool instruction; full adapter test remains pending |
| baseline syntax QA | PASS | Node `v24.14.0`, `npm run check` |

## Smoke usage

session metadata의 `token_count` event를 source of truth로 사용한다.

```json
{
  "runtime": "codex_cli",
  "model": "gpt-5.6-luna",
  "reasoning_effort": "medium",
  "input_tokens": 12938,
  "cached_input_tokens": 0,
  "output_tokens": 107,
  "reasoning_tokens": 72,
  "elapsed_ms": 5334
}
```

`reasoning_tokens`는 `output_tokens`의 subset으로 취급하며 이중 계산하지 않는다.

handoff의 2026-08-12 accounting snapshot을 적용하면:

```text
codex_credit_equivalent = 0.06469
api_equivalent_usd      = 0.01358
```

단, handoff snapshot의 API-equivalent 가격(`$1.00 / $0.10 / $6.00`)과 현재 공식 GPT-5.6 Luna API 문서의 가격 표기가 일치하지 않는다. M7 benchmark에서는 두 기준을 조용히 혼합하지 않고, benchmark 시작 전 최종 보고서의 가격 기준을 확정한다.

## Checkpoint A

```text
M7_CODEX_PREFLIGHT_READY
M7_USER_REVIEW_REQUIRED
```

## 보류 항목

- `M7_FOUR_ARM_GOLDEN_COMPLETE` 미실행
- fresh golden 17의 68회 run 미실행
- Luna D/AO PH 미실행
- full runtime adapter 및 offline direct-MCP isolation test 미구현/미실행
- 가격 스냅샷의 최종 accounting 기준 사용자 검토 필요

다음 단계는 주인님이 Checkpoint A와 가격 기준을 검토한 뒤 Phase B benchmark를 별도로 승인하는 것이다.
