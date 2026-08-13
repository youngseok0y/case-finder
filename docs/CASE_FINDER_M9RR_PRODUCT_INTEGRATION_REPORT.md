# CASE-FINDER M9-RR Product Integration Report

상태: `M9RR_PRODUCT_INTEGRATION_IMPLEMENTED` — automated QA 완료, live API smoke 재검증 대기, 커밋 전 작업 트리

## 기준점

- base SHA: `bde6a92cf757bf8cbfcea2d8904af8f21af29fcd`
- final SHA: 커밋 전이므로 미정
- 검색 configuration: 변경하지 않음

## 수정 내용

### Product result contract

Node 내부 product contract를 camelCase canonical shape으로 통일했다.

- `contractVersion`, `adapterId`, `candidateCaseNumbers`, `lawReferences`
- `outputValid`, `modelProtocolClean`, `selectionRepaired`
- `protocolDiagnostics`, `rejectedSelected`, `executionPin`
- `validationFailures`, `fallbackLabel`, `terminalState`

upstream D/AO-v2의 snake_case 입력은 adapter 경계에서 한 번만 정규화한다. server는 더 이상 결과를 `fromResultContract()`로 역변환하지 않으며, 결과에 snake_case 이중 필드를 생성하지 않는다. `assertResultContract()`는 canonical shape과 snake/camel ambiguity를 검사한다.

### Luna evidence scope

`createAgenticSearchV2()`에 invocation-scoped `runWithContext()`를 추가했다. Luna adapter는 `persistentSearch.lastRun`을 correctness 경로에서 사용하지 않고 해당 호출이 반환한 `{ result, ledger }`를 사용한다.

- `candidateCaseNumbers`: 해당 invocation의 `ledger.getObservedCaseNumbers()`
- `items`: 해당 invocation의 verified ledger candidate
- law evidence: observed + text-opened ledger law만 `lawReferences`로 전달
- 동시 요청이 서로의 candidate/evidence를 참조하지 않는 회귀 테스트 추가

기존 `lastRun` getter는 진단/호환 용도로만 남겨 두었으며 product serialization은 사용하지 않는다.

### Safety signaling

`outputValid=false` 결과를 일반 `NO_RESULT`로 렌더링하지 않고 `SAFETY_REJECTED` terminal로 분리했다. UI에는 안전 검증 실패 안내만 표시하고 raw protocol diagnostic은 노출하지 않는다.

### Codex environment isolation

Codex child process는 OS/runtime 및 `CODEX_HOME` allowlist만 상속한다. `GEMINI_API_KEY`, `LAW_OC`, `GOOGLE_APPLICATION_CREDENTIALS` 등 Case Finder secret은 전달하지 않는다. restricted legal MCP bridge만 `.env`에서 `LAW_OC`를 읽고 upstream legal MCP에 전달한다.

### MCP reconnect

MCP timeout/error 시 stale transport handle을 보존한 뒤 best-effort close하고 reconnect한다. transport `onclose`가 새 transport 상태를 덮어쓰지 않도록 identity check도 추가했다.

### Windows launcher

`start.bat`는 포트가 사용 중일 때 `/health`의 `service=case-finder`를 확인한다. Case Finder가 아닌 foreign process는 PID를 알아도 종료하지 않고 중단한다. 오류 로그 안내도 실제 `logs/error.log`와 일치시켰다.

## 검증 결과

- `npm run check`: PASS
- `npm run product:test`: PASS
- product tests: 32 passed, 0 failed
- `git diff --check`: PASS

추가된 회귀 범위:

- canonical contract → validator → renderer: Gemini D/Luna
- candidate evidence 보존 및 closed-world rejection
- Luna concurrent invocation scope isolation
- `outputValid=false`와 `NO_RESULT` 분리
- Codex child secret exclusion
- stale MCP transport close
- foreign-port launcher protection

## 수동/외부 의존 검증

이전 Chromium smoke에서는 `/health`와 자연어 화면 렌더링, console error 0을 확인했다. 후속 외부 진단에서 다음을 확인했다.

- `LAW_OC`는 현재 셸과 `korean-law.cmd`에 전달된다.
- `korean-law.cmd get_decision_text --domain precedent --id 614471`는 4.9.6의 정상 syntax로 실행되지만 `precedent iframe did not include taxlaw redirect location`으로 실패한다.
- 같은 상세 URL은 `curl.exe`에서 Referer 없이 실패하고, Referer만 추가하면 `PrecService`가 포함된 JSON으로 성공한다. User-Agent만으로는 성공하지 않는다.
- 그러나 4.9.6의 Node/undici `fetchWithRetry`는 Referer를 이미 주입하고도 동일한 access-validation 응답을 받는다.

따라서 현재 blocker는 OC/IP 등록 자체가 아니라 `curl.exe`와 Node/undici 사이의 법제처 요청 처리 차이(HTTP client/anti-bot fingerprint 또는 전송 계층)다. Case Finder의 `process.env` 전달 누락으로 단정할 근거는 없다. live 판례 상세 smoke는 MCP transport 호환성 수정 또는 upstream transport 수정 후 재실행해야 한다.

## 변경하지 않은 범위

- Gemini D prompt/query policy/ranking/selector
- Luna prompt/search policy/reasoning/tool allowlist
- EvidenceLedger 및 FinalSelectionGate eligibility semantics
- A6 복구, 신규 benchmark, UI redesign
