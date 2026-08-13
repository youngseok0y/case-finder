# 작업 전 `case-finder-spec.md`를 먼저 읽습니다.

이 프로젝트는 Fable 규격의 로컬 판례 검색기입니다. 명세의 정확성 계약과 변경 금지 사항을 임의로 완화하지 않습니다.

- A1: 판례·법령 원문 필드는 법제처 API 원문만 사용합니다.
- A2: Gemini는 검색어 생성과 후보 목록 안의 선택만 수행합니다.
- A3: 출력 전 모든 사건번호를 후보 존재와 상세 조회 성공으로 검증합니다.
- A4: 링크는 API 상세링크 또는 검증된 일련번호 기반 URL만 사용합니다.
- A5: 결과가 없으면 없다고 표시하고 지어내지 않습니다.
- A6: 고정 프롬프트와 JSON 스키마를 사용하며 생성 파라미터를 임의 설정하지 않습니다.
- A7: Gemini 실패 시 법제처 검색 결과와 결정론 랭킹으로 폴백합니다.
- Product v2: 제품 adapter는 `gemini_d`와 `luna_native`만 사용합니다. `gemini_a6`와 Gemini AO-v2는 legacy 연구 경로입니다.
- Luna: restricted legal MCP, EvidenceLedger, FinalSelectionGate, verified-only output을 반드시 유지합니다. Luna 실패를 Gemini로 silent fallback하지 않습니다.
- Adapter pinning: `gemini_d`는 Gemini + D, `luna_native`는 Codex/Luna + Native AO-v2 + `gpt-5.6-luna` + `medium`으로 고정합니다.
- No leakage: private reasoning, system prompt, raw tool planning, 인증 토큰을 UI·로그·admin에 남기지 않습니다.

작업 순서는 명세의 M0부터 M10까지 따릅니다. M9 이후 검색 prompt·policy·tool·reasoning을 임의로 바꾸지 않습니다. 범위를 넓히거나 정확성 계약을 바꾸기 전에는 주인님의 승인을 받습니다.
