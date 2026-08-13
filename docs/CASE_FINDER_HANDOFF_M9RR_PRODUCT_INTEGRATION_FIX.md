# CASE-FINDER HANDOFF M9-RR
## Corrective Product Integration Patch — Contract, Luna Isolation, Safety Signaling, Runtime Hardening

> 상태: **REQUIRED BEFORE M10**
>
> 목적: M9-R 이후 발견된 제품 통합 경계 문제를 수정한다.  
> 이번 단계는 검색 품질 실험이 아니며, 검색 configuration은 동결한다.
>
> ```text
> Gemini → gemini_d → Deterministic D
> Codex → luna_native → GPT-5.6 Luna medium
>       → Native AO-v2
>       → restricted legal MCP
>       → EvidenceLedger
>       → FinalSelectionGate
> ```
>
> 목표 terminal:
>
> ```text
> M9RR_PRODUCT_INTEGRATION_STABLE
> ```

---

## 0. 기준점

현재 `main` 기준:

```text
bde6a92cf757bf8cbfcea2d8904af8f21af29fcd
[M9R] Record GitHub cleanup completion
```

현재 active branch:

```text
main
m9r-production-baseline-cleanup
```

M9-R cleanup 자체는 완료된 것으로 취급한다.

---

## 1. 이번 리뷰에서 확인된 문제

### P0 — M10 전에 필수 수정

1. **result contract ↔ validator/renderer 필드 불일치**
2. **Luna candidate evidence 직렬화 누락**
3. **Luna `persistentSearch.lastRun` 공유 state race**
4. **Luna concurrent isolation test 부재**
5. **adapter → contract → validator → renderer 통합 test 부재**

### P1 — 제품 안전성/운영 hardening

6. `outputValid=false`가 일반 NO_RESULT로 보일 수 있음
7. Codex child process가 전체 `process.env`를 상속
8. MCP timeout/reconnect 시 stale transport close 누락 가능
9. `start.bat`가 해당 포트의 다른 프로세스를 강제 종료 가능
10. launcher가 안내하는 오류 로그 파일명과 실제 logger 파일명이 다름

### P2 — M10 연결

11. Luna law evidence를 product `lawReferences`로 provenance-preserving serialization

---

## 2. 절대 변경 금지

이번 단계에서 다음을 변경하지 않는다.

```text
Gemini D prompt
Gemini D query policy
Gemini D ranking
candidateMax
resultMax
searchDisplay
Gemini selector policy

Luna prompt
Luna reasoning effort
Luna tool allowlist
Luna search policy
Luna safety thresholds
FinalSelectionGate eligibility semantics
EvidenceLedger eligibility semantics

새 benchmark
새 blind set
A6 복구
Gemini AO-v2 복구
```

문제는 검색 알고리즘이 아니라 **제품 통합 계층**이다.

---

# PART A — Product Result Contract

## 3. P0-1 — Product contract 통일

현재 adapter contract는 일부 값을 snake_case로 직렬화하지만 기존 validator/renderer는 camelCase 필드를 기대한다.

대표 mismatch:

```text
candidate_case_numbers ↔ candidateCaseNumbers
law_references         ↔ lawReferences
execution_pin          ↔ executionPin
protocol_diagnostics   ↔ protocolDiagnostics
```

현재 server 흐름:

```text
adapter.runNaturalQuery()
→ product result contract
→ validateNaturalResult()
→ renderer
```

이므로 mismatch는 실제 verified 판례가 validator에서 탈락하는 통합 회귀가 될 수 있다.

---

## 4. Product runtime naming convention

권장 결정:

> **Node 내부 product contract는 camelCase로 통일한다.**

예:

```js
{
  contractVersion,
  adapterId,
  provider,
  architecture,

  route,
  query,
  intro,

  selected,
  items,

  candidateCaseNumbers,
  lawReferences,

  outputValid,
  modelProtocolClean,
  selectionRepaired,
  protocolDiagnostics,
  rejectedSelected,

  executionPin,
  telemetry,
  error
}
```

HTTP 외부 JSON에서 snake_case가 필요해지는 경우에만 별도 serialization layer에서 변환한다.

---

## 5. 이중 필드 금지

다음을 피한다.

```js
{
  candidateCaseNumbers: [...],
  candidate_case_numbers: [...]
}
```

같은 데이터의 이중 source는 silent divergence를 다시 만든다.

제품 runtime은 하나의 canonical field만 사용한다.

---

## 6. Contract acceptance

다음이 동일한 contract를 사용해야 한다.

```text
geminiDAdapter
lunaNativeAdapter
validator
renderer
server
product tests
```

특히:

```text
candidateCaseNumbers
lawReferences
outputValid
```

는 단일 이름으로 고정한다.

---

# PART B — Luna Evidence Scope

## 7. P0-2 — Luna candidate evidence 직렬화

Luna natural validator가 closed-world validation을 수행하려면
product contract에 **모델 선택값이 아니라 실제 search-observed candidate set**이 있어야 한다.

source:

```text
EvidenceLedger
→ getObservedCaseNumbers()
```

권장:

```js
candidateCaseNumbers: ledger.getObservedCaseNumbers()
```

또는 동등한 run-scoped observed snapshot.

---

## 8. Luna candidate invariant

최종 결과는:

```text
selection.caseNumber ∈ candidateCaseNumbers
AND
matching item.status === verified
AND
detail identity matches
```

를 만족해야 한다.

FinalSelectionGate와 product validator의 2중 검증은 유지 가능하지만,
둘 다 같은 provider-observed evidence를 기준으로 해야 한다.

---

## 9. P0-3 — `lastRun` correctness dependency 제거

현재 Luna adapter가 하나의 persistent search instance를 재사용하면서:

```text
persistentSearch.lastRun.ledger
```

를 result item 복원에 사용하면 concurrent request에서 race가 발생할 수 있다.

예:

```text
A start → lastRun = ledger A
B start → lastRun = ledger B
A finish → A result + ledger B를 참조
```

이 구조는 질문 간 evidence contamination 가능성이 있으므로 제품 correctness 경로에서 금지한다.

---

## 10. 권장 수정

가장 선호:

```js
const run = await search.runWithContext(query);

run.result
run.ledger
run.telemetry
```

처럼 **해당 invocation의 result와 ledger를 구조적으로 결합**한다.

또는 AO-v2 return object 자체에 adapter가 필요한 observed/verified evidence를 충분히 담아서 shared state 조회 없이 serialization한다.

---

## 11. Persistent의 의미

persistent adapter에서 공유해도 되는 것:

```text
adapter instance
session factory
static config
```

공유하면 안 되는 것:

```text
ledger
question scope
candidate set
verified cases
selection state
```

---

## 12. P0-4 — Luna concurrent regression test

필수 신규 test:

```js
await Promise.all([
  adapter.runNaturalQuery("질문 A"),
  adapter.runNaturalQuery("질문 B")
]);
```

A와 B가 서로 다른 사건을 관측하도록 fixture 구성.

검증:

```text
A.items → A case only
B.items → B case only

A.candidateCaseNumbers → A only
B.candidateCaseNumbers → B only

question_scope_id differs
cross-question evidence contamination = 0
```

실패 terminal:

```text
M9RR_LUNA_SCOPE_RACE
```

---

# PART C — Product Integration Test

## 13. P0-5 — 자연어 통합 경로 test 추가

현재 safety core unit test만으로는 다음 seam을 잡지 못한다.

```text
adapter
→ result contract
→ validator
→ renderer
```

신규 test 권장:

```text
test/productNaturalIntegration.test.js
```

---

## 14. Gemini D 통합 fixture

mock result:

```text
candidateCaseNumbers
selected
verified item
lawReferences
```

를 adapter → validator → renderer까지 전달.

PASS:

```text
verified selected survives
verified item survives
lawReferences survives
case appears in rendered HTML
```

---

## 15. Luna 통합 fixture

run-scoped ledger/result를 만들어:

```text
observed
detail verified
selected
```

가 product contract와 validator를 거쳐 유지되는지 확인.

---

## 16. Invalid protocol 통합 fixture

```text
outputValid=false
```

인 result가 정상 `NO_RESULT`로 렌더되지 않는지 확인.

---

# PART D — Safety Failure Signaling

## 17. P1-6 — `outputValid=false`와 NO_RESULT 분리

제품 terminal state 권장:

```text
SUCCESS
NO_RESULT
PARTIAL_VERIFIED
SEARCH_FAILED
SAFETY_REJECTED
```

최소 요구:

```text
NO_RESULT != SAFETY_REJECTED
```

---

## 18. server behavior

adapter result가:

```text
outputValid === false
```

이면 일반 empty-result renderer로 보내지 않는다.

사용자 메시지 예:

```text
검색 결과를 안전하게 검증하지 못해 결과를 표시하지 않았습니다.
다시 검색해 주세요.
```

raw protocol diagnostic은 UI에 노출하지 않는다.

---

# PART E — Codex Secret Isolation

## 19. P1-7 — Codex child env 최소화

현재 Codex child가 전체:

```js
{ ...process.env }
```

를 상속한다면 불필요한 Case Finder secret까지 모델 프로세스에 전달될 수 있다.

제품 원칙:

> **모델 프로세스가 필요로 하지 않는 secret은 전달 자체를 하지 않는다.**

---

## 20. Codex env allowlist

필요한 OS/runtime env만 유지한다.

예:

```text
PATH
PATHEXT
SYSTEMROOT
WINDIR
COMSPEC
TEMP
TMP
USERPROFILE
APPDATA
LOCALAPPDATA
HOME
```

실제 Codex 실행에 필요한 최소 변수는 확인 후 추가한다.

제거 필수 검토:

```text
GEMINI_API_KEY
LAW_OC
GOOGLE_APPLICATION_CREDENTIALS
기타 Case Finder secret
```

---

## 21. Restricted MCP와 env 분리

구조:

```text
Codex model process env
≠
restricted legal MCP upstream env
```

법제처 인증이 필요한 legal bridge만 필요한 secret을 가진다.

Codex 본체는 `LAW_OC`를 볼 필요가 없어야 한다.

---

## 22. Codex env test

가능하면 env builder를 pure function으로 분리.

PASS:

```text
codexChildEnv.GEMINI_API_KEY === undefined
codexChildEnv.LAW_OC === undefined
```

---

# PART F — MCP Reconnect

## 23. P1-8 — stale transport cleanup

timeout/error 후 기존 transport handle을 잃기 전에 best-effort close한다.

권장 개념:

```js
const staleTransport = transport;
client = null;
transport = null;

await staleTransport?.close().catch(...);
```

실제 reconnect ordering은 현재 구조에 맞게 안전하게 조정한다.

---

## 24. timeout 주의

`Promise.race()` timeout은 underlying MCP request cancellation을 보장하지 않을 수 있다.

따라서:

```text
timeout
→ stale connection 정리
→ reconnect serialization
```

을 명시적으로 다룬다.

새 connection pool 같은 큰 구조는 만들지 않는다.

---

## 25. MCP reconnect test

mock:

```text
first call times out
old transport.close() called
second connection succeeds
```

가능한 범위에서 test.

---

# PART G — Windows Launcher Safety

## 26. P1-9 — foreign process kill 금지

현재 port가 사용 중이라는 이유만으로:

```text
taskkill /F
```

하면 안 된다.

다른 프로그램이 3300번 port를 쓰고 있을 수 있다.

---

## 27. `/health` identity marker

권장:

```json
{
  "service": "case-finder",
  "ok": true
}
```

launcher가 기존 port의 `/health`를 확인한다.

---

## 28. launcher 정책

```text
port free
→ start

port used by Case Finder
→ restart allowed

port used by unknown process
→ do not kill
→ show PID/port and abort
```

---

## 29. P1-10 — log filename

launcher가 안내하는 log filename과 실제 logger 파일을 일치시킨다.

권장:

```text
logs/error.log
```

---

# PART H — Luna Law Evidence

## 30. P2-11 — Luna law evidence serialization

M10의 관련 법규 toggle 전에 Luna가 수집한 law evidence를
product `lawReferences`로 전달할 수 있어야 한다.

현재 item에:

```text
lawReferences: []
```

가 고정되어 있다면 개선 대상.

---

## 31. provenance 원칙

source:

```text
EvidenceLedger observed law
+
get_law_text opened/verified
+
provider raw text/meta
```

모델이 법령 제목/조문/전문을 생성하면 안 된다.

---

## 32. defer 조건

이번 patch에 자연스럽게 포함 가능하면 구현.

복잡하면:

```text
M9RR_LAW_SERIALIZATION_DEFERRED_TO_M10
```

로 명시하고 M10 첫 작업으로 넘길 수 있다.

단:

```text
candidateCaseNumbers
```

P0는 defer 금지.

---

# PART I — Regression Boundaries

## 33. 검색 drift 금지

M9-RR 전후:

```text
Gemini D ranking semantics
Gemini D selected identity
Luna FinalSelectionGate eligibility
Luna tool allowlist
```

가 달라지면 안 된다.

---

## 34. Direct route 보존

```text
direct case-number route
→ LLM calls = 0
```

유지.

---

## 35. Adapter pins 보존

Gemini D:

```text
provider=gemini
architecture=D
runtime=gemini
```

Luna:

```text
provider=codex_luna
architecture=AO_V2_NATIVE
model=gpt-5.6-luna
reasoning=medium
```

---

# PART J — Test Plan

## 36. Contract tests

```text
candidateCaseNumbers preserved
lawReferences preserved
executionPin preserved
outputValid preserved
```

---

## 37. Validator tests

```text
observed + verified → survives
candidate absent → rejected
detail mismatch → rejected
duplicate → rejected
```

---

## 38. Luna concurrency tests

```text
Promise.all two requests
distinct ledgers
distinct items
distinct candidate pools
cross contamination = 0
```

---

## 39. Safety signaling tests

```text
outputValid=false
→ SAFETY_REJECTED/SEARCH_FAILED
→ not normal NO_RESULT
```

---

## 40. Secret tests

```text
Codex child env has no GEMINI_API_KEY
Codex child env has no LAW_OC
```

---

## 41. MCP reconnect tests

```text
timeout
→ stale close
→ reconnect
```

---

## 42. package scripts

신규 product integration/concurrency tests를:

```text
npm run product:test
```

에 포함.

`npm run check`에도 신규 runtime/test 파일 추가.

---

# PART K — QA

## 43. Automated QA

필수:

```bash
npm run check
npm run product:test
npm run verify
git diff --check
```

---

## 44. Manual browser smoke — 사람 직접 검증

M9-RR 완료 후 Playwright 자동화는 필수 아님.

사용자가 직접:

```text
정상 사건번호 1건
없는 사건번호 1건
Gemini D 자연어 2건
Luna 자연어 2건
```

확인.

---

## 45. Manual 확인 포인트

```text
자연어 verified 결과가 validator 뒤에도 남는가
사건번호 링크가 정상인가
판시사항/판결요지가 표시되는가
Luna가 빈 결과로 소실되지 않는가
관련 법규가 비정상 소실되지 않는가
Console error 없는가
Network response에 secret 없는가
```

UI 미관은 이번 판정 대상이 아니다.

---

## 46. Foreign-port manual test

가능하면 3300번에 별도 임시 서버를 띄운 뒤 `start.bat` 실행.

PASS:

```text
foreign process를 자동 kill하지 않음
```

---

## 47. Security manual test

Luna run 후:

```text
state/codex-runtime
logs
proxy logs
HTTP response
```

에 다음 raw value가 없는지 확인.

```text
GEMINI_API_KEY
LAW_OC
Codex auth token
기타 credential
```

---

# PART L — Branch / Commit

## 48. Branch

권장:

```text
m9rr-product-integration-fix
```

base:

```text
main@bde6a92cf757bf8cbfcea2d8904af8f21af29fcd
```

---

## 49. Commit 구조

권장:

```text
[M9RR] Fix product result contract and Luna isolation
[M9RR] Harden runtime safety and launcher behavior
[M9RR] Add product integration regressions
```

---

# PART M — Stop-loss

## 50. Search scope violation

검색 policy/tuning이 바뀌면:

```text
M9RR_SEARCH_SCOPE_VIOLATION
```

중단.

---

## 51. Luna safety invalid

EvidenceLedger/FinalSelectionGate 우회:

```text
M9RR_LUNA_SAFETY_INVALID
```

중단.

---

## 52. Contract ambiguity

snake/camel dual fields가 서로 다른 값을 가질 수 있는 상태:

```text
M9RR_CONTRACT_AMBIGUOUS
```

수정 후 진행.

---

## 53. Luna scope race

cross-question evidence contamination 1건:

```text
M9RR_LUNA_SCOPE_RACE
```

M10 진입 금지.

---

## 54. Codex secret exposure

불필요한 API key/LAW_OC가 Codex model process에 전달:

```text
M9RR_CODEX_SECRET_EXPOSURE
```

수정 필수.

---

## 55. Launcher unsafe

Case Finder가 아닌 foreign process를 종료:

```text
M9RR_LAUNCHER_UNSAFE
```

수정 필수.

---

# PART N — Out of Scope

## 56. 이번 단계에서 하지 않는다

```text
M10 progress bar
quota UI
admin UI
law toggle UI
court service guidance UI
design redesign

Playwright automation
installer EXE
optional dependency slimming
Node bundling

새 blind benchmark
검색 tuning
모델 변경
```

---

# PART O — Deliverable

## 57. Report

tracked:

```text
docs/CASE_FINDER_M9RR_PRODUCT_INTEGRATION_REPORT.md
```

포함:

```text
base SHA
final SHA

contract before/after
Luna candidate serialization
lastRun correctness dependency 제거
concurrency test

safety failure signaling
Codex env isolation
MCP reconnect handling
launcher foreign-port behavior
log path correction

test results
manual browser result
known limitations
```

---

# PART P — Terminal

## 58. Success criteria

모두 PASS:

```text
Gemini D natural result survives validator
Luna natural result survives validator

candidateCaseNumbers valid
lawReferences product contract consistent

Luna concurrent scope contamination = 0
shared lastRun correctness dependency = 0

outputValid=false != NO_RESULT

Codex model env secret exposure = 0
MCP stale transport cleanup implemented
foreign port process auto-kill = 0

npm run check PASS
npm run product:test PASS
npm run verify PASS
git diff --check PASS

manual browser smoke PASS
```

terminal:

```text
M9RR_PRODUCT_INTEGRATION_STABLE
```

---

# PART Q — M10 Entry

## 59. M10 진입 조건

M9-RR 종료 후 corrected `main`에서:

```text
m10-productization-ui
```

branch를 만든다.

그 후에만:

```text
progress
quota
admin
law toggle
direct miss court guidance
UI redesign
```

을 시작한다.

---

## 60. 최종 원칙

이번 문제는 검색 engine 자체의 실패가 아니다.

M9-R에서 연구 harness를 정리하고 제품 server/validator/renderer에 다시 연결하는 과정에서
**contract와 invocation scope 사이 통합 경계가 충분히 검증되지 않은 것**이 핵심이다.

따라서 해결도:

> **검색 알고리즘을 다시 만지는 것이 아니라, product contract를 하나로 만들고 각 요청의 evidence scope를 구조적으로 분리하는 것**

이어야 한다.

M9-RR 완료 후:

```text
Gemini D
Luna Native AO-v2
```

두 product configuration이 동일한 제품 contract를 통해
안전하게 server → validator → renderer에 연결되어야 한다.
