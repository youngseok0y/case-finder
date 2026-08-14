# Fable Case Finder

법제처 Open API 원문과 검증된 상세 조회만으로 동작하는 로컬 판례 검색기예요. 제품 adapter는 `gemini_d`와 `luna_native`만 지원하며, Luna 실패를 Gemini로 자동 전환하지 않아요.

## 제품 설치·실행

1. 배포된 `CaseFinderSetup.exe`를 실행해 설치해요.
2. 설치 후 생성된 `.env`에 `LAW_OC`를 입력해요.
3. `luna_native`를 사용할 때는 Codex/Luna 로그인을 완료해요.
4. `Case Finder`를 실행해 `http://127.0.0.1:3300`을 열어요.

설치본은 다음 구조를 사용해요.

```text
%LOCALAPPDATA%\Fable\CaseFinder\
  app\
  app\node_modules\
  runtime\node\node.exe
  logs\
```

설치본은 private Node runtime으로 `app\src\server.js`를 실행하고, 제품 실행 중 `npm ci`를 수행하지 않아요. Luna는 `app\node_modules`에 고정된 `@openai/codex-sdk`와 Windows platform package를 사용하며, 시스템 PATH·WindowsApps·`CODEX_CLI_PATH`를 정상 실행 경로로 사용하지 않아요.

## 정확성·안전 계약

- 판례·법령 원문은 법제처 API 원문만 사용해요.
- Gemini는 검색어 생성과 후보 목록 안의 선택만 수행해요.
- 출력 전 사건번호의 후보 존재와 상세 조회 성공을 모두 검증해요.
- 검증되지 않은 사건번호나 임의 링크를 결과에 넣지 않아요.
- Luna는 restricted legal MCP, EvidenceLedger, FinalSelectionGate, verified-only output을 유지해요.
- 직접 사건번호 조회에는 LLM을 호출하지 않아요.

## 개발 설치

개발 환경에서는 Node.js `>=24.14.0 <25`를 사용해요.

```text
copy .env.example .env
npm ci
npm start
```

정적·제품 검증은 다음 명령으로 실행해요.

```text
npm run check
npm run product:test
npm run verify
```

설치 후 검증은 설치 루트에서 managed Node, SDK packaged runtime, `/health`, restricted MCP, Luna 질문을 순서대로 확인해요. golden의 hit%나 자연어 문구 동일성은 참고 지표이며, SDK runtime의 안정적인 `gpt-5.6-luna`/`medium` 실행과 verified-only 계약을 통과 기준으로 삼아요.

```text
runtime\node\node.exe app\src\verifyManagedRuntime.js --install-root "%LOCALAPPDATA%\Fable\CaseFinder"
```

제품 UI는 기존 `POST /ask` JSON 호환성을 유지하면서 `POST /ask/stream` SSE를 사용해 실제 검색 단계만 표시해요. 로컬 설정은 `/admin`에서 whitelist 필드로 저장하며, secret 실제 값은 조회 응답에 반환하지 않아요. 저장한 설정은 서버 재시작 후 적용돼요.

상세 명세는 [case-finder-spec.md](./case-finder-spec.md), M9RR3 구현 계약은 [runtime-manifest.json](./packaging/runtime-manifest.json)을 기준으로 해요.
