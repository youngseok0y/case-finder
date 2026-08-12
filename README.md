# Fable 판례 검색기

법제처 국가법령정보 Open API에 존재하는 원문만 표시하는 로컬 판례 검색기입니다.

## 실행

1. Node.js `>=24.14.0 <25` 범위의 버전을 설치합니다.
2. `.env.example`을 `.env`로 복사하고 `LAW_OC`를 입력합니다.
3. 최초 1회 `npm ci`를 실행합니다.
4. `start.bat`을 실행하거나 `npm start`를 실행합니다.
5. 브라우저에서 `http://localhost:3300`을 엽니다.

현재 구현은 M6C 평가 단계입니다. 사건번호 직접 조회와 두 가지 자연어 검색 모드(D: 결정론, A6: 질문당 6회 제한 에이전틱)를 제공하며, 기본 `PIPELINE_MODE=deterministic`은 고정 JSON 스키마의 검색계획·후보 내 선별과 결정론 랭킹을 사용합니다. `PIPELINE_MODE=agentic`은 허용된 4개 MCP 도구의 함수 호출 루프를 사용합니다. `AGENTIC_MODE=open`은 AO(open-horizon) 비교 평가 전용 설정이며 제품 기본 모드로 확정되지 않았습니다. 에이전틱 도구 결과는 검색 목록·판례 요지·메타데이터를 구조화해 전달하고, 관측된 사건번호만 선택하는 닫힌 검증을 적용합니다. 판시사항·판결요지·관련법규는 법령센터 원문만 표시하며, Gemini 실패 또는 내부 호출 한도 초과 시 결정론 결과로 폴백합니다. Gemini 사용량은 `state/usage.json`에 기록되며 내부 한도는 분당 13회·태평양 시간 기준 하루 450회입니다.

`start.bat` 실행 후 cmd 창은 런처로 유지됩니다. 메뉴에서 `S` 서버 시작, `R` 재시작, `X` 종료, `Q` 런처 종료를 선택할 수 있습니다. 서버 출력은 런처 cmd 창에 표시되며 오류 로그는 `logs/error.log`에 기록됩니다.

## 검증 세트

M5/M6C 회귀 세트는 `test/golden.json`에 있습니다. 서버를 실행한 뒤 기본 검증은 Gemini를 호출하지 않는 직접조회·무존재 항목만 실행합니다.

```text
npm run verify -- --base-url=http://127.0.0.1:3300
```

자연어 항목과 반복 일관성까지 실행할 때는 모드별 서버를 별도로 띄운 뒤 다음처럼 실행합니다. 자연어 검증은 Gemini quota를 사용합니다.

```text
npm run verify -- --base-url=http://127.0.0.1:3310 --mode=deterministic --include-natural --repeat=3
npm run verify -- --base-url=http://127.0.0.1:3311 --mode=agentic --include-natural --repeat=3
```

M6C의 현재 비교 결과와 아직 확정되지 않은 제품 모드, 후속 작업은 [`docs/CASE_FINDER_FINAL_REPORT_M6C.md`](./docs/CASE_FINDER_FINAL_REPORT_M6C.md)와 [`docs/CASE_FINDER_NEXT_TASKS_M6C.md`](./docs/CASE_FINDER_NEXT_TASKS_M6C.md)를 참고합니다.

M6D Phase A 기준선 재집계 결과는 [`docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md`](./docs/CASE_FINDER_M6D_BASELINE_REANALYSIS.md)에 있으며, Phase B RPM pacing 결과는 [`docs/CASE_FINDER_M6D_RPM_PACER.md`](./docs/CASE_FINDER_M6D_RPM_PACER.md)에 있습니다. RPM full은 대기하고 RPD/RPD reserve는 hard stop으로 유지합니다. private holdout 질문 본문은 저장소에 기록하지 않으며, 사용자 제공 전에는 블라인드 실행을 시작하지 않습니다.

M6D private holdout 30회 실행·외부 reviewer 판정·최종 arm 비교는 [`docs/CASE_FINDER_FINAL_REPORT_M6D.md`](./docs/CASE_FINDER_FINAL_REPORT_M6D.md)에 있습니다. terminal marker는 `M6D_D_RETAINED`이며, private 원문·packet·review 점수는 저장소에 포함하지 않습니다.

## 원칙

상세 설계와 정확성 계약은 [case-finder-spec.md](./case-finder-spec.md)를 유일한 기준으로 삼습니다. `.env`, `state/`, `logs/`의 운영 데이터와 API 키는 커밋하지 않습니다.
