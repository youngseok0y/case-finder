# PH AO Single-Call Experiment Report

## Result

AO open-mode를 PH01 질문으로 1회 호출했다.

- `agent_stop_reason`: `MODEL_FINAL`
- Gemini requests: 2회
- agent MCP calls: 1회
- search calls: 1회
- detail calls: 0회
- raw candidates: 20개
- model selection: `2016다2451` 1건
- fallback: 사용하지 않음
- HTTP/result: 200 / 정상

## 조기 종결 원인

첫 Gemini turn에서 다음 검색 function call을 수행했다.

```text
search_decisions(query="취업규칙 불이익변경 근로자과반수동의 상여금")
```

검색 결과로 사건번호 20개가 새로 관측됐다. 두 번째 Gemini 응답에는 function call이 없고 selection JSON만 있었으므로, `runAgenticSearch`가 이를 모델의 최종 응답으로 판단해 `MODEL_FINAL`로 종료했다. 따라서 `NO_NEW_EVIDENCE`나 `SAFETY_WATCHDOG_STOP`에 의한 종료가 아니다.

현재 AO open mode는 A6의 질문당 6회 제한을 해제하고 RPD reserve·wall-clock·no-new-evidence 안전장치를 적용한다. 그러나 모델이 function call 없이 selection을 반환하면 최소 탐색 횟수나 detail function call을 강제하지 않는다. 즉 `open`은 “더 탐색할 수 있음”이지 “반드시 더 탐색함”을 의미하지 않는다.

관련 코드:

- `src/agenticPipeline.js:397`: function call이 없으면 `MODEL_FINAL`
- `src/agenticPipeline.js:463`: 새 근거 없음이 3회 누적될 때만 `NO_NEW_EVIDENCE`
- `config.js:28`: AO no-new-evidence threshold 기본값 3

## quota rollover

호출 시점에 Pacific 기준 일자가 넘어갔다. 따라서 로컬 usage는 `2026-08-11 / 399`에서 `2026-08-12 / 1`로 rollover되었고, `399→1`은 음의 소모량이 아니다. 두 Gemini 요청은 날짜 경계 전후로 나뉘었다. 현재 로컬 카운터는 새 Pacific 날짜의 1회로 해석해야 한다.

실험 raw trace는 `logs/ao-single-experiment.json`에 저장되어 있으며, PH holdout packet과 review score에는 포함하지 않았다.

## 판단

이번 1회 호출에서 확인된 조기 종결은 코드 오류나 quota stop이 아니라 모델이 검색 결과만으로 충분하다고 판단해 final selection을 반환한 정상적인 `MODEL_FINAL` 경로다. AO가 항상 추가 detail 조회까지 수행해야 한다는 제품 요구가 있다면, 별도의 최소 evidence/detail gate를 설계해야 한다.
