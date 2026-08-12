# PH Private Holdout Run Report

## 상태

`PH_AWAITING_EXTERNAL_BLIND_REVIEW`

PH01–PH30을 기존 M6D evidence와 분리한 private holdout으로 실행하고, 외부 reviewer용 blind packet을 생성했다. reviewer scores가 들어오기 전에는 arm unmask와 품질 결론을 수행하지 않는다.

## 실행 범위

- 질문: 30개 (`PH01`–`PH30`)
- arm: D, A6, AO
- 계획 실행: 90회
- 실제 실행: 90회
- protocol PASS: 90회
- protocol FAIL: 0회
- packet samples: 117개
- packet issues: 0개

## quota 및 pacing

- provider RPD 관측 시작값: 102/500
- provider RPD 관측 종료값: 399/500
- 실행 중 Gemini 요청: 297회
- RPM hard stop: 0회
- RPD hard stop/reserve stop: 0회
- RPM wait events: 34회
- RPM wait time: 154,309ms
- local hard limit: 450
- AO reserve: 30

현재 packet은 외부 reviewer에게 전달할 수 있는 상태다. 실행 로그, unmask key, packet은 `test/private/ph-holdout/` 및 `logs/ph-private-holdout-*` 아래에 보관하며 Git 추적 대상이 아니다.

## 보정 기록

PH23-AO 실행의 한 verified item은 법제처 provider ID와 상세 조회 검증은 통과했지만 검색 결과의 링크 필드가 비어 있었다. A4를 유지하기 위해 provider ID와 precedent domain으로 검증 가능한 법제처 serial URL을 복원하고 packet을 재생성했다. 이후 packet issue는 0건이며 누락 provider ID/link도 0건이다. 동일한 상황의 재발을 막도록 결정론적 decision detail link fallback도 코드에 반영했다.

## reviewer handoff

- Instructions: `docs/PH_PRIVATE_BLIND_REVIEW_INSTRUCTIONS.md`
- Blind packet: `test/private/ph-holdout/blind_packet.json`
- 권장 scores: `test/private/ph-holdout/blind_review_scores.jsonl`
- unmask key: 외부 reviewer에게 전달하지 않음
