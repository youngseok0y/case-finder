# Case Finder M6D Phase B RPM Pacer

## 상태

`M6D_RPM_PACER_READY`

- 기준 브랜치: `Agentic_diagnose`
- 기준 SHA: `df28007c52cd48fdb8fd5066ee4bdf209a42b0ff`
- private holdout 및 외부 Gemini 호출: 실행하지 않음
- 새 질문 본문: 생성·추측·저장하지 않음

Phase B의 목적은 rolling RPM 한도 초과를 agent 종료 사유로 처리하지 않고, 다음 사용 가능 슬롯까지 대기시키는 것이다. RPD, RPD reserve, A6 질문 횟수 제한은 기존 hard stop으로 유지했다.

## 구현 결과

- RPM 한도 도달: `waitMs = oldestRecentCall + window + 350ms - now`를 계산하고 write lock을 해제한 뒤 sleep한다.
- RPM 대기는 usage write lock을 점유하지 않는다.
- RPD full / RPD reserve: `GeminiLimitExceededError`를 발생시킨다.
- A6: 기존 질문당 6회 제한을 유지한다.
- AO: 고정 질문 횟수 제한을 적용하지 않는다.
- Gemini provider 429: 첫 요청 후 동일 pacer를 다시 통과하며 retry를 별도 Gemini request로 집계한다.
- D / A6 / AO telemetry에 `gemini_rpm_wait_events`, `gemini_rpm_wait_ms`를 추가했다.
- RPM wait margin은 `config.js`의 `geminiRpmWaitMarginMs = 350`으로 고정했다.

RPM pacing은 MCP latency나 MCP 결과를 조정하는 방식으로 구현하지 않았다.

## 변경 파일

- `config.js`
- `src/rateLimiter.js`
- `src/gemini.js`
- `src/nlPipeline.js`
- `src/agenticPipeline.js`
- `test/m6d-rpm-pacer.js`
- `package.json`

## 검증

다음 명령을 통과했다.

```text
npm run check
npm run m6d:test:pacer
git diff --check
```

RPM 테스트 checkpoint 출력에는 다음 항목이 포함된다.

```text
test_rpm_full_waits_instead_of_throwing
test_wait_does_not_hold_usage_write_lock
test_rpd_limit_still_throws
test_rpd_reserve_still_throws
test_a6_question_limit_still_six
test_ao_has_no_fixed_question_limit
test_retry_passes_rpm_pacer_again
test_retry_counts_as_gemini_request
test_rpm_wait_ms_is_recorded
test_rpm_wait_event_count_is_recorded
```

## 다음 checkpoint

`M6D_AWAITING_PRIVATE_HOLDOUT`

사용자가 제공할 10개 private 질문을 받기 전까지 Phase C 실행, 질문 생성, holdout run, blind packet 생성은 하지 않는다.
