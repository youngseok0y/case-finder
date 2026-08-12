# Case Finder M6D Private Holdout Run Report

## 상태

`M6D_BLIND_REVIEW_VALIDATED`

- 실행일: 2026-08-12 (Pacific usage date: 2026-08-11)
- 입력: 사용자 제공 MH01–MH10, 10문항 hash freeze
- 실행: D / A6 / AO 각 1회, 총 30 run
- 외부 reviewer 판정: 44/44 수신·schema PASS
- 관련성·coverage 품질 집계 및 unmask: 완료

초기 sandbox 네트워크 경로에서 MCP 외부 API 오류가 발생한 부분 실행은 중단·폐기했다. 아래 수치는 local RPD를 0으로 다시 초기화한 뒤 승인된 네트워크 경로에서 완료한 최종 30 run만 포함한다.

## Quota context

| 항목 | 값 |
|---|---:|
| 사용자 제공 provider RPD context | 0 / 500에서 시작 |
| 앱 local RPD limit | 450 |
| 앱 local RPD final | 102 |
| RPM | 13 / rolling 60초 |
| RPM wait margin | 350ms |
| AO RPD reserve | 30 |
| 총 Gemini requests | 102 |
| 총 RPM wait events / ms | 18 / 72,293ms |
| RPM_LIMIT_STOP | 0 |

provider의 실제 일일 사용량은 이 로컬 실행에서 독립 조회할 수 없으므로, provider 값은 사용자가 제공한 0/500 context로만 기록하고 local usage를 별도로 집계했다.

## Run integrity

| 항목 | 값 |
|---|---:|
| total runs | 30 |
| D / A6 / AO | 10 / 10 / 10 |
| protocol PASS | 30/30 |
| protocol FAIL | 0 |
| non-empty outputs | 30/30 |
| rendered items all verified | PASS |
| packet issues | 0 |

## Table A — arm별 quota와 실행

| arm | avg req | median | p90 | max | safe daily capacity | avg RPM wait ms | total MCP | avg elapsed ms | stop reason | fallback rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| D | 2.00 | 2.00 | 2.00 | 2 | 210 | 138.5 | 468 / 46.8 | 14,217.4 | MODEL_FINAL 10 | 0.0% |
| A6 | 4.30 | 4.00 | 6.00 | 6 | 97 | 2,976.2 | 36 / 3.6 | 9,736.1 | MODEL_FINAL 7, QUESTION_CALL_LIMIT 3 | 50.0% |
| AO | 3.90 | 3.50 | 5.30 | 8 | 107 | 4,114.6 | 29 / 2.9 | 10,183.7 | MODEL_FINAL 10 | 10.0% |

safe daily capacity는 앱 local RPD 450에서 30 reserve를 제외한 420을 arm 평균 Gemini request로 나눈 보수적 추정치다. 이는 품질 우열이나 제품 채택 결론이 아니다.

## Table B — 품질 판정 상태

외부 reviewer가 아직 relevance를 판정하지 않았으므로 다음 값은 비워 둔다.

| arm | question wins | DIRECT-hit questions | usable selected count | relative axis coverage | irrelevant rate |
|---|---:|---:|---:|---:|---:|
| D | pending | pending | pending | pending | pending |
| A6 | pending | pending | pending | pending | pending |
| AO | pending | pending | pending | pending | pending |

## Blind packet

- reviewer Instructions: `docs/CASE_FINDER_M6D_PRIVATE_BLIND_REVIEW_INSTRUCTIONS.md`
- packet: `test/private/m6d-holdout/blind_packet.json`
- sample 수: 44
- unmask key: `test/private/m6d-holdout/unmask_key.json`
- private 질문·packet·unmask key: `test/private/`로 ignore되며 tracked repository에 포함하지 않음

packet에는 `sample_id`, `question_id`, 질문 본문, provider ID, 법령센터 source locator만 포함했다. arm, session/run ID, 검색어, Gemini/MCP quota, fallback, 순위, 기존 정답은 packet에서 숨겼다.

## 다음 단계

최종 결과는 [`docs/CASE_FINDER_FINAL_REPORT_M6D.md`](./CASE_FINDER_FINAL_REPORT_M6D.md)에 기록했다. terminal marker는 `M6D_D_RETAINED`이며, 10문항 표본의 제한을 명시한 채 M6D를 종료한다.
