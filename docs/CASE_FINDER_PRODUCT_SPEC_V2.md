# Case Finder Product Specification v2.0
## M9 확정 이후 제품화 기준

> 상태: **FINAL PRODUCT SEARCH CONFIGURATION CONFIRMED**
>
> 최종 제품 검색 구성:
> - `gemini_d` — **Gemini D / 빠른·경량 검색**
> - `luna_native` — **GPT-5.6 Luna / Native AO-v2 / 고정밀 검색**
>
> Gemini A6는 연구·회귀 비교용 legacy adapter로만 보존하고 사용자 UI에는 노출하지 않는다.
> Gemini AO-v2는 제품 후보에서 종료한다.

---

## 1. 제품 목표

Case Finder는 사건번호 또는 자연어 법률 질문을 입력받아 실제 provider가 제공한 법률 원문에 근거한 판례·법령 검색 결과를 제공한다.

우선순위:

1. 환각 방지 / source grounding
2. 판례 검색 품질
3. 사용자가 검색 과정을 이해할 수 있는 UX
4. 로컬 설치·운영의 단순성
5. 모델·quota 선택 가능성

법률 자문 시스템이 아니라 **판례·법령 검색 및 정리 시스템**이다.

---

## 2. M9 최종 검색 구성 결정

M9 Blind-30은 30문항 × Gemini D / Gemini A6 / Luna Native = 90 records로 실행했다.

| Arm | Question wins | DIRECT-hit Q | Usable | Broad usable | Irrelevant |
|---|---:|---:|---:|---:|---:|
| Gemini D | 6 | 13/30 | 37 | 47 | 28.4% |
| Gemini A6 | 5 | 18/30 | 28 | 41 | 10.9% |
| Luna Native | 14 | 19/30 | 46 | 62 | 4.6% |

운영 지표:

```text
Gemini D
- 59 Gemini requests / 30Q
- 1.97 requests/question

Gemini A6
- 123 Gemini requests / 30Q
- 4.10 requests/question

Luna Native
- 30 native Codex sessions
- 368 legal MCP calls
- 65/65 visible items verified
- output_valid 30/30
- forbidden tool contamination 0
```

따라서 제품에서는:

```text
Gemini D
= 빠른 / 경량 / Gemini API 기반

Luna Native AO-v2
= 고정밀 / Codex ChatGPT quota 기반
```

두 configuration을 최종 선택지로 확정한다.

---

## 3. Luna 승격의 정확한 의미

승격 대상은 `gpt-5.6-luna` 모델 단독이 아니다.

다음 전체 configuration을 하나의 제품 후보로 확정한 것이다.

```text
GPT-5.6 Luna medium
+
persistent Codex native session
+
restricted korean-law MCP
+
per-question EvidenceLedger
+
LegalToolGateway
+
FinalSelectionGate
+
verified-only renderer contract
```

M9에서 Luna는:

```text
model_protocol_clean 17/30
selection_repaired   13/30
```

이었다.

따라서 다음 해석을 금지한다.

```text
"Luna 자체 출력이 충분히 안전하므로 validator를 제거한다"
```

정확한 결론:

> **Native Luna의 탐색 능력 + Case Finder의 host-side evidence/validation 안전장치가 결합된 configuration이 M9 Blind-30에서 최종 확인되었다.**

EvidenceLedger / FinalSelectionGate / restricted tool surface는 제품 필수 구성요소다.

---

## 4. 제품 Adapter

### 4.1 `gemini_d`

표시명:

```text
Gemini 빠른 검색
```

기존 D의 검색 계획·ranking·selector·validator는 제품화 단계에서 변경하지 않는다.

### 4.2 `luna_native`

표시명:

```text
Luna 고정밀 검색
```

내부:

```text
Luna medium
→ persistent native Codex session
→ restricted legal MCP
→ EvidenceLedger
→ FinalSelectionGate
→ verified-only result
```

허용 legal tools:

```text
search_decisions
get_decision_text
search_law
get_law_text
```

금지:

```text
shell
command execution
web/browser
repo/file inspection
Git/GitHub
unrelated MCP
```

### 4.3 Legacy

`gemini_a6`는 benchmark/regression/debug 용도로만 보존하고 제품 dropdown에는 노출하지 않는다.

---

## 5. 정확성 계약 — Product v2

### P-A1. Provider 원문 전용

다음 사용자 표시 필드는 provider 원문에서만 가져온다.

```text
법령 조문 전문
판시사항
판결요지
결정요지
사건번호
법원
선고일
공식 상세 링크
```

### P-A2. Evidence-bound identity

최종 판례는 반드시:

```text
provider search observed
AND
provider detail opened
AND
detail identity verified
```

여야 한다.

compound case number는 provider raw evidence에서 파생된 verified member/alias만 허용한다.

### P-A3. FinalSelectionGate 유지

Luna final selection은 항상 host gate를 통과한다.

```text
unverified → reject
not observed → reject
invalid match → reject
duplicate → dedupe
unsafe intro identifier → repair/remove
```

### P-A4. Link provenance

법령/판례 링크는 provider의 실제 identity/detail locator에 기반한다.

### P-A5. Honest empty result

찾지 못한 판례를 채워 넣지 않는다.

### P-A6. Adapter pinning

```text
gemini_d
→ provider=Gemini
→ architecture=D

luna_native
→ provider=Codex/Luna
→ architecture=Native AO-v2
→ model=gpt-5.6-luna
→ reasoning=medium
```

환경변수 충돌로 다른 runtime이 실행되면 요청을 중단한다.

### P-A7. Silent fallback 금지

Luna 실행 실패 시 몰래 Gemini로 바꾸지 않는다. 사용자가 다른 adapter를 선택하도록 안내한다.

### P-A8. No reasoning leakage

Progress UI, log, admin UI에 private reasoning/system prompt/raw tool planning/auth token을 노출하지 않는다.

---

## 6. 직접 사건번호 검색

직접 사건번호 검색은 계속 **LLM 0회**를 유지한다.

성공 시 사건번호, 사건명, 법원/선고일, 판시사항, 판결요지/결정요지, 관련 법령, 공식 링크를 제공한다.

---

## 7. 직접 조회 실패 UX

Primary:

```text
해당 사건번호의 판결을 국가법령정보센터에서 찾지 못했습니다.
사건번호가 정확한지 다시 확인해 주세요.
```

Secondary:

```text
국가법령정보센터에 수록되지 않았거나 공개 범위가 다른 판결은
대한민국 법원의 판결서 인터넷열람 또는 판결서사본 제공신청에서
확인할 수 있는 경우가 있습니다.
```

공식 법원 안내 기준 helper:

```text
형사
- 2013-01-01 이후 확정 판결서

민사·행정·특허
- 2015-01-01 이후 확정
  또는
- 2023-01-01 이후 선고
```

단, 해당 범위면 반드시 검색된다고 단정하지 않는다.

CTA:

```text
[판결서 인터넷열람 안내]
[판결서사본 제공신청]
```

---

## 8. 자연어 결과 — 판례 표시 정책

제품 renderer는 adapter가 반환한 **모든 verified `result.items`**를 표시한다.

현재와 같은 renderer-level `detailMax` 제한으로 하위 결과의 판시사항/판결요지를 숨기지 않는다.

"모두 제공"의 의미:

```text
adapter final result에 포함되고
detail verification까지 성공한 판례 전부
```

raw search candidate 전체를 추가로 detail-open한다는 뜻은 아니다.

각 판례 카드:

```text
사건번호 + 공식 링크
사건명
법원
선고일
관련성 label
판시사항
판결요지/결정요지
```

---

## 9. 관련 법규 UI

관련 법령은 기본 접힘.

예:

```text
통신비밀보호법 제3조
통신 및 대화비밀의 보호
[전문 보기 ▾]
```

확장 시 provider에서 취득한 조문 전문을 보여준다.

권장: native `<details>`.

법령센터 링크는 유지한다.

조문 제목은 provider에서 확인된 경우에만 표시한다.

---

## 10. Loading / Progress UX

확정 threshold:

```text
LOADING_UI_THRESHOLD_MS = 1000
```

1초 안에 끝나면 상세 loading UI를 표시하지 않는다.

Progress는 실제 host event 기반이며 시간 기준 가짜 %를 만들지 않는다.

예 event:

```text
SEARCH_STARTED
ROUTE_IDENTIFIED
ANALYSIS_COMPLETE
LAW_EVIDENCE_UPDATED
CANDIDATES_FOUND
DETAIL_VERIFIED
FINALIZING
SEARCH_COMPLETE
SEARCH_FAILED
```

표시 예:

```text
관련 판례를 찾고 있습니다.          68%

███████████████░░░░░

✓ 질문 분석
✓ 관련 법령 확인
✓ 판례 후보 검색
● 판례 원문 검증 · 4건 확인
○ 결과 정리
```

Progress는 monotonic host indicator이며 ETA가 아니다.

허용 정보:

```text
후보 수
검증된 판례 수
확인된 관련 법령 수
현재 단계
```

금지:

```text
raw search query
tool args
system prompt
chain-of-thought
```

---

## 11. Streaming contract

기존 `POST /ask` JSON은 유지한다.

제품 UI용 권장:

```text
POST /ask/stream
response content-type: text/event-stream
```

브라우저는 `fetch()` response stream을 읽는다.

final event에 최종 HTML/result를 담는다.

별도 DB/WebSocket/search-task server는 만들지 않는다.

---

## 12. Quota UX

서버 시작 시 quota 정보를 가능한 범위에서 조회한다.

Quota 조회 실패는 서버 시작/검색 기능을 막지 않는다.

예:

```text
Gemini    82% 남음 · 추정
Luna      64% 남음 · 17:42 초기화
```

---

## 13. Codex quota

Codex App Server의 structured RPC:

```text
account/rateLimits/read
```

사용.

주요 값:

```text
usedPercent
windowDurationMins
resetsAt
rateLimitReachedType
```

`remaining = 100 - usedPercent`.

"5시간/주간"을 무조건 hard-code하지 않고 실제 window 정보를 사용한다.

App Server unavailable이면 `Luna 사용량 확인 불가`로 degrade한다.

---

## 14. Gemini quota

Gemini quota는 project 단위이며 일반적으로 RPM/TPM/RPD를 사용한다.

GCP Monitoring 인증이 있으면 공식 quota usage/limit metric을 사용한다.

없으면 기존 Case Finder local counter를 사용하고 반드시:

```text
로컬 추정
```

으로 표시한다.

다른 앱에서 같은 project를 사용한 양은 local estimate에 반영되지 않을 수 있음을 안내한다.

---

## 15. Quota abstraction

```text
QuotaService
├─ CodexQuotaProvider
│   └─ App Server
└─ GeminiQuotaProvider
    ├─ CloudMonitoring
    └─ LocalEstimator
```

quota는 UX 정보이며 validator와 결합하지 않는다.

---

## 16. Admin UI

기존 v1.1의 "관리자 UI 비목표"는 폐기한다.

로컬 전용 `/admin` 추가.

raw `.env` editor는 금지하고 whitelist 설정만 제공한다.

최소:

```text
SEARCH_ADAPTER
GEMINI_API_KEY
LAW_OC
CODEX_CLI_PATH
CODEX_TIMEOUT_MS
GCP_PROJECT_ID
```

모델 dropdown:

```text
Gemini 빠른 검색 → gemini_d
Luna 고정밀 검색 → luna_native
```

A6 제외.

Secret 실제 값은 GET 응답에 반환하지 않고 configured 여부만 표시한다.

`.env` 저장은 atomic write를 권장한다.

현재 config가 startup freeze이므로 초기 제품에서는 저장 후:

```text
서버 재시작 후 적용됩니다.
```

정책을 사용한다.

---

## 17. Admin safety

서버는 `127.0.0.1`에만 bind한다.

Admin write는:

```text
same-origin only
CORS disabled
JSON only
whitelist only
```

cross-origin write를 거부한다.

---

## 18. Status UI

검색 화면에 간단한 상태 영역:

```text
검색 엔진      Gemini 빠른 검색
법령 API       연결됨
Gemini quota   82% 남음 · 로컬 추정
Luna quota     64% 남음
```

상세 env/secret은 admin에만 둔다.

---

## 19. Result page 구조

```text
[사용자 질문]

[안내문]

[관련 판례]
  모든 verified item
  판시사항
  판결요지/결정요지

[관련 법규]
  조문 summary
  [전문 보기]

[출처/면책]
```

직접 lookup miss는 Court-service guidance card로 대체한다.

---

## 20. 기술 원칙

Node 내장 http와 가벼운 정적 UI를 유지한다.

필요하면:

```text
public/index.html
public/app.js
public/styles.css
```

로 분리한다.

React/Vue/Vite/DB를 새로 도입하지 않는다.

---

## 21. Productization 검색 동결

M10에서 금지:

```text
D prompt/ranking/query/selector 변경
candidateMax/resultMax 실험
Luna prompt/search policy/tool 변경
Luna reasoning effort 변경
새 model benchmark
새 blind set
A6 재튜닝
```

M9를 검색 configuration 선택의 마지막 benchmark로 취급한다.

---

## 22. 제품 acceptance invariants

```text
direct route LLM calls = 0

visible precedent:
search observed + detail verified

visible statute:
provider detail sourced

Luna forbidden contamination = 0

unverified visible identifiers = 0

quota failure does not block search

admin never returns secrets

loading UI < 1 second = hidden
progress monotonic
```

---

## 23. 최종 제품 결정

**2026-08-13 M9 Blind-30 결과를 기준으로 검색 configuration을 최종 확인한다.**

```text
Gemini D
→ 빠른/경량 검색

Luna Native AO-v2
→ 고정밀 검색
→ safety-gated configuration 전체를 승격
```

Gemini A6와 Gemini AO-v2의 제품 후보 선정 연구는 종료한다.

**Luna는 안전장치를 제거한 모델 단독으로 승격된 것이 아니다.**

**M9에서 검증된 EvidenceLedger + FinalSelectionGate + restricted MCP configuration 그대로 제품 후보로 최종 확인되었다.**
