# Fable Case Finder

법제처 국가법령정보 Open API에 실제로 존재하는 판례·법령 원문만 표시하는 로컬 판례 검색기입니다. 법률 자문이 아니라 검색·정리 도구입니다.

## 제품 검색 구성

사용자에게 제공하는 검색 adapter는 두 가지입니다.

- `gemini_d` — Gemini 빠른 검색: 결정론적 검색계획, 법제처 후보 검색, 후보 내 선별
- `luna_native` — Luna 고정밀 검색: GPT-5.6 Luna medium, Native AO-v2, restricted legal MCP, EvidenceLedger, FinalSelectionGate

Gemini A6와 Gemini AO-v2는 연구 history에 보존하지 않고 제품 runtime에는 포함하지 않습니다. Luna 실행 실패 시 Gemini로 자동 전환하지 않습니다.

## 설치·실행

1. Node.js `>=24.14.0 <25`를 설치합니다.
2. `.env.example`을 `.env`로 복사합니다.
3. `LAW_OC`에 법제처 Open API 인증키를 입력합니다.
4. Gemini를 사용할 경우 `GEMINI_API_KEY`를 입력합니다.
5. `SEARCH_ADAPTER`를 `gemini_d` 또는 `luna_native`로 선택합니다.
6. 최초 1회 `npm ci`를 실행한 뒤 `start.bat` 또는 `npm start`를 실행합니다.
7. 브라우저에서 `http://127.0.0.1:3300`을 엽니다.

Luna를 선택하면 `CODEX_CLI_PATH`와 Codex 로그인 상태가 필요합니다. Codex native session은 질문별 작업 디렉터리를 `state/codex-runtime` 아래에 만들며, `.env`와 인증 토큰을 결과나 로그에 기록하지 않습니다.

## 정확성·안전 원칙

- 사건번호, 법원, 선고일, 판시사항, 판결요지·결정요지, 법령 조문과 공식 링크는 provider 원문·메타데이터에서만 가져옵니다.
- 최종 판례는 provider 검색 관측, 상세 조회 성공, 상세 identity 검증을 모두 통과해야 표시됩니다.
- Luna는 restricted legal MCP만 사용하며 EvidenceLedger와 FinalSelectionGate를 우회하지 않습니다.
- 검증되지 않은 사건번호나 찾지 못한 판례를 채워 넣지 않습니다.
- 직접 사건번호 조회는 LLM을 호출하지 않습니다.

## 개발 검증

```text
npm run check
npm run product:test
npm run verify
```

검증 세트는 Luna safety, EvidenceLedger, FinalSelectionGate, restricted legal tool surface, compound case identity, adapter pinning을 포함합니다. 실제 법제처·모델 호출이 필요한 운영 검증은 별도 인증키와 실행 환경에서 수행합니다.

## 운영 파일

- `state/`: quota·Codex native session 등 runtime writable state
- `logs/`: 오류와 validator 기록
- `.env`: 로컬 전용 설정이며 커밋하지 않습니다.

상세 설계와 정확성 계약은 [case-finder-spec.md](./case-finder-spec.md)를 canonical specification으로 사용합니다. M9 결과와 제품 구성 결정은 [M9 최종 보고서](./docs/CASE_FINDER_FINAL_REPORT_M9_BLIND30.md)에 기록되어 있습니다.
