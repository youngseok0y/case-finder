# 판례 검색 프로그램(case-finder) 구현 명세서 v2.0

> **이 문서를 읽는 AI 작업자(Codex / Claude Code)에게**
> 이 문서는 본 프로젝트의 유일한 기준 문서(single source of truth)입니다.
> - 3장 「정확성 계약」과 17장 「변경 금지 사항」은 어떤 경우에도 임의로 완화하지 마십시오.
> - M9에서 확정된 제품 검색 구성은 `gemini_d`와 `luna_native`입니다. `gemini_a6`는 연구·회귀 비교용 legacy로만 보존하고 사용자 UI에 노출하지 않습니다.
> - 18장 「구현 시 확인이 필요한 미확정 사항」은 구현 착수 시 반드시 실제 값을 확인하고 이 문서를 갱신하십시오.
> - 구현 판단이 이 문서와 충돌하면, 코드를 바꾸지 말고 사람에게 질문하십시오.

---

## 1. 프로젝트 개요

### 1.1 목표
- 사용자가 **자연어로 법률 질문**을 하면, 국가법령정보(법제처 Open API) 데이터에 **실존하는** 법령 조문과 판례만을 근거로 정리된 결과를 출력한다.
- 사용자가 **사건번호(예: 2020다12345)** 를 입력하면 LLM을 전혀 거치지 않고 해당 판례를 직접 조회해 보여준다.
- 본 프로젝트의 존재 이유는 "LLM이 존재하지 않는 판례를 지어내는 문제"의 해결이다. **환각 0건**이 최우선 품질 목표다.

### 1.2 비목표 (하지 않는 것)
- 법률 자문·해석 제공 (검색·정리까지만)
- 외부 공개 서비스 (사내/로컬 사용 전제)
- 사용자 인증, DB 서버, 캐시 서버 등 무거운 인프라
- WebSocket/search-task 서버, React/Vue/Vite 등 무거운 인프라
- Gemini 유료 티어 사용
- `gemini_a6` 또는 Gemini AO-v2를 제품 검색 선택지로 노출
- Luna 실행 실패 시 다른 adapter로 자동 전환하는 silent fallback

### 1.3 사용 환경
- 사내 Windows PC 로컬 실행, `start.bat` 더블클릭으로 기동
- 서버는 `127.0.0.1`에만 bind한다.
- 브라우저에서 `http://localhost:포트` 접속, 질문 입력 → 결과 표시
- 로컬 전용 `/admin`에서 whitelist 설정과 adapter·quota 상태를 확인한다. 비밀값 자체는 반환하지 않는다.

---

## 2. 기술 스택 및 버전 고정 정책

| 구성요소 | 선택 | 고정 방법 |
|---|---|---|
| 런타임 | Node.js `>=24.14.0 <25` | `package.json`의 `engines.node`에 허용 범위 명시 |
| MCP 서버 | `korean-law-mcp` (npm, chrisryugj) — 로컬 stdio 구동 | `package.json` dependencies에 **정확 버전**(예: `"korean-law-mcp": "4.x.y"` — ^, ~ 금지). §18-A 참조 |
| MCP 클라이언트 | `@modelcontextprotocol/sdk` | 정확 버전 고정 |
| LLM | 제품: Gemini D (`gemini-3.5-flash-lite`) / Luna Native (`gpt-5.6-luna`, medium) | adapter가 provider·architecture·model·reasoning을 pin. Gemini A6는 legacy 비교용 |
| Native runtime | Codex native persistent session / AO-v2 | `luna_native` adapter 전용. restricted legal MCP와 host-side evidence gate를 필수 적용 |
| 웹 서버 | Node 내장 `http` 모듈 (프레임워크 없음) | 의존성 자체가 없음 |
| 기타 | `dotenv` 1개 정도만 허용 | 정확 버전 고정 |

**버전 고정 규칙 (전 항목 공통)**
1. `package.json`의 모든 의존성은 정확 버전으로 기재한다. `^`, `~`, `latest`, `*` 금지.
2. `package-lock.json`을 반드시 커밋한다. 설치는 `npm ci`만 사용한다 (`npm install` 금지 — README와 start.bat에 명시).
3. korean-law-mcp를 `npx korean-law-mcp@latest`로 실행하는 방식은 **금지**한다. 반드시 고정 버전을 로컬 의존성으로 설치하고 `node_modules/.bin/korean-law-mcp`를 실행한다.
4. 버전을 올릴 때는 §17.2의 업그레이드 절차를 따른다.

**왜 이렇게 하는가**: 이 프로젝트는 인수인계 후 비개발자가 LLM의 도움만으로 유지보수한다. "어제는 됐는데 오늘 안 된다"의 원인 후보를 0개로 만드는 것이 목적이다. 실제로 korean-law-mcp는 버전에 따라 노출 도구 개수·이름이 크게 바뀌어 왔다(v3: 14~17개 → v4.4: 통폐합 9~10개). 버전이 떠다니면 시스템이 침묵 속에서 깨진다.

---

## 3. 정확성 계약 (Accuracy Contract) — 절대 규칙

아래 규칙은 코드 전체를 관통하는 불변식이다. 위반하는 코드는 버그다.

- **A1. 원문 전용 필드**: 최종 출력의 「관련법규 조문 내용」, 「판시내용(판시사항)」, 「판결요지」는 **법제처 API 응답 원문에서만** 가져온다. Gemini가 생성·요약·의역한 텍스트를 이 필드에 넣는 것을 금지한다.
- **A2. 닫힌 선택(closed-world selection)**: Gemini의 역할은 (a) 검색어 생성, (b) **앱이 제시한 후보 목록 안에서의 선택·순위화**, (c) 한두 문장의 안내문 작성으로 한정한다. Gemini는 사건번호·법령명·조문번호를 스스로 생산할 수 없다.
- **A3. 출력 전 실존 검증**: 최종 출력에 등장하는 모든 사건번호는 (1) 후보 목록에 존재했고 (2) `get_decision_text` 전문 조회에 성공한 것이어야 한다. 하나라도 실패하면 해당 항목을 **조용히 빼지 말고** 검증 실패로 로그에 남기고 출력에서 제외한다.
- **A4. 링크는 API 데이터로만 생성**: 법령센터 링크는 API 응답에 포함된 상세링크 필드 또는 응답의 일련번호(판례일련번호 등) 기반 고정 URL 패턴으로만 만든다. 사건번호 문자열로 URL을 추측 조립하지 않는다. (§18-B)
- **A5. 결과 없음의 정직한 처리**: 일치 판례가 없으면 "정확히 일치하는 판례를 찾지 못했습니다"를 명시하고, 있으면 관련 판례를 「관련 판례」라고 **라벨을 구분해** 보여준다. 빈 결과를 채우기 위해 무엇도 지어내지 않는다. korean-law-mcp가 반환하는 `[NOT_FOUND]` 마커는 그대로 실패로 처리한다.
- **A6. 결정론 우선**: 고정 프롬프트 파일과 고정 responseSchema(JSON)만 사용하고, 자유 서술형 응답을 파싱하는 코드를 만들지 않는다. **temperature 등 생성 파라미터는 코드 어디에서도 설정하지 않고 SDK 기본값을 쓴다** — Gemini 3.1 이후 Google이 생성 파라미터 조정 자제를 권고하고 있으며, 설정 시 오류 발생 가능성이 있다(운영자 확인 사항). 결정론은 파라미터가 아니라 스키마·닫힌 선택·validator로 확보한다.
- **A7. Gemini 실패 ≠ 서비스 실패**: Gemini 호출이 실패(429 포함)해도 검색 자체는 법제처 API로 수행되었으므로, 결정론 점수(§6.1 단계 3) 기준 상위 결과를 "AI 선별 없이 검색 결과만 표시합니다" 라벨과 함께 출력한다.

### 3.1 Product v2 추가 불변식

M9 이후 제품화에서는 A1~A7에 더해 다음 불변식을 적용한다.

- **P-A1. Provider 원문 전용 범위 확대**: 법령 조문 전문, 판시사항, 판결요지·결정요지뿐 아니라 사건번호, 법원, 선고일, 공식 상세 링크도 provider 원문·메타데이터에서만 가져온다.
- **P-A2. Evidence-bound identity**: 최종 판례는 provider 검색에서 관측되고, provider 상세 조회가 성공하며, 상세 identity가 검증된 경우에만 표시한다. compound 사건번호는 raw evidence에서 확인된 verified member/alias만 허용한다.
- **P-A3. FinalSelectionGate 필수**: `unverified`, `not observed`, `invalid match`를 reject하고 중복을 dedupe한다. 사건번호·조문번호가 포함된 안전하지 않은 intro는 제거 또는 repair한다.
- **P-A4. Link provenance**: 판례·법령 링크는 provider의 실제 identity/detail locator에서만 생성한다.
- **P-A5. Honest empty result**: 검색되지 않았거나 검증되지 않은 결과를 채워 넣지 않는다.
- **P-A6. Adapter pinning**: `gemini_d`는 Gemini + D, `luna_native`는 Codex/Luna + Native AO-v2 + `gpt-5.6-luna` + `medium`으로 고정한다. 환경변수 충돌로 다른 runtime이 선택되면 실행을 중단한다.
- **P-A7. Silent fallback 금지**: Luna 실행 실패 시 Gemini로 몰래 전환하지 않는다. 사용자가 다른 adapter를 선택하도록 안내한다.
- **P-A8. No reasoning leakage**: progress UI·로그·admin UI에 private reasoning, system prompt, raw tool planning, 인증 토큰을 노출하지 않는다.

---

## 4. 시스템 아키텍처

```
사용자 브라우저 (검색 화면)
        │  POST /ask 또는 POST /ask/stream
        ▼
┌──────────────────────────────────────────────┐
│  app (Node.js, 내장 http 서버)                  │
│                                              │
│  [1] router.js ── 사건번호 정규식 판별            │
│        │ 매치                 │ 불일치           │
│        ▼                     ▼                │
│  [2] directLookup.js   [3] nlPipeline.js      │
│   (LLM 0회)          (D 또는 Luna Native)        │
│        │                     │                │
│        └──────┬──────────────┘                │
│               ▼                               │
│  [4] EvidenceLedger / FinalSelectionGate        │
│               ▼                               │
│  [5] validator.js ── 정확성 계약 집행             │
│               ▼                               │
│  [6] renderer.js ── 출력 템플릿(§8)로 변환        │
└───────┬──────────────────────────┬───────────┘
        │ MCP(stdio, 자식 프로세스)     │ HTTPS
        ▼                          ▼
  korean-law-mcp (로컬)      Gemini API / Codex Native
        │ HTTPS                (quota 경유)
        ▼
  법제처 국가법령정보 Open API (무제한)
```

**핵심 설계 결정 — M9에서 제품 검색 구성을 확정했다**

`SEARCH_ADAPTER` 값으로 제품 검색 구성을 선택한다.

- **모드 D — 결정론 파이프라인 (§6.1)**: 앱이 고정된 파이프라인을 실행하고, Gemini는 정해진 두 지점(검색어 생성, 후보 내 선별)에서만 JSON으로 답한다. 질문당 호출이 정확히 2회로 고정된다. 장점: quota 예산을 산술적으로 계획할 수 있고, 흐름이 코드에 명시돼 유지보수·디버깅이 쉽다. 단점: **검색 유동성이 크게 떨어져** 정형을 벗어난 질문에 약하다 (운영자 사전 테스트에서 확인된 사항).
- **Luna Native (§6.3)**: `gpt-5.6-luna` medium의 persistent native session과 restricted legal MCP를 사용한다. 탐색은 유연하지만 최종 출력은 EvidenceLedger와 FinalSelectionGate를 통과한 verified item만 허용한다.
- **Gemini A6 (§6.2)**: Gemini 함수 호출 기반의 legacy 비교·회귀 adapter로만 보존한다. 제품 dropdown에는 노출하지 않고, prompt/search policy/reasoning을 M10에서 재튜닝하지 않는다.

모든 구성은 정확성 계약(§3)의 동일한 적용을 받는다. 특히 Evidence-bound identity, FinalSelectionGate, validator가 adapter와 무관하게 출력 전 검증을 집행한다. Luna 실행 실패를 Gemini로 자동 전환하지 않는다(P-A7).

---

## 5. 입력 라우팅 (router.js)

### 5.1 사건번호 패턴
아래 정규식에 매치되면 Route B(직접 조회), 아니면 Route A(자연어 파이프라인).

```js
// 연도(4자리) + 사건부호(한글 1~3자) + 일련번호(1~7자리)
// 예: 2020다12345, 2022두56077, 2021헌마123, 96다31574
const CASE_NO = /((?:19|20)\d{2})\s*([가-힣]{1,3})\s*(\d{1,7})/g;
```

- 공백 제거 후 `연도+부호+번호`로 정규화한다 (`2020 다 12345` → `2020다12345`).
- 한 입력에 사건번호가 여러 개면 전부 추출해 각각 조회한다 (최대 5개, 초과분은 안내 후 무시).
- 사건번호와 자연어가 섞여 있으면("2020다12345 판례 보여줘") 사건번호 라우트를 우선한다.
- 사건부호에 따른 도메인 매핑: `헌`으로 시작(헌마·헌바·헌가 등) → `constitutional`, 그 외 → `precedent`. 매핑 실패 시 두 도메인 모두 시도.

### 5.2 그 외 입력
- 빈 입력, 10,000자 초과 입력은 요청 전에 거부한다.

---

## 6. Route A — 자연어 처리 (nlPipeline.js): 제품 adapter 구성

`SEARCH_ADAPTER`(config.js)로 제품 구성을 선택한다: `gemini_d` 또는 `luna_native`. `gemini_a6`는 6.2의 legacy 비교·회귀 경로로만 보존한다.

### 6.1 모드 D — 결정론 파이프라인

질문당 Gemini 호출은 **정확히 2회**다. 단계별로:

#### 단계 1. Gemini 호출 ① — 검색 계획 생성
- 입력: 사용자 질문 원문
- 출력(responseSchema로 강제):

```json
{
  "keywords": ["문자열 8~12개"],
  "law_names": ["관련 가능성이 있는 법령명 0~5개"],
  "domains": ["precedent", "constitutional", "admin_appeal" 중 해당되는 것]
}
```

- 프롬프트는 `prompts/plan.txt`에 파일로 두고 버전 관리한다. 요지: "이 질문으로 대한민국 판례를 찾기 위한 검색어를 만들어라. 법률 용어·일상 용어·유사 표현을 섞어 8~12개. 판단하지 말고 검색어만."
- **검색어를 다양하게 여러 개 만드는 이유**: 단일 검색어의 우연성을 줄이고, 여러 검색식에 **중복 등장하는 판례**를 신뢰 신호로 쓰기 위함(아래 단계 3). 법제처 API는 무제한이므로 검색 횟수는 아끼지 않는다.

#### 단계 2. MCP 병렬 검색 (Gemini 미사용)
- `keywords` × `domains` 조합으로 `search_decisions`를 병렬 호출한다 (동시성 5 정도로 제한 — 법제처 서버 예의).
- `law_names`가 있으면 `search_law`도 호출해 법령 실존 여부와 lawId/MST를 확보해 둔다.
- 결과를 사건번호 기준으로 병합(dedupe)한다.

#### 단계 3. 결정론적 1차 랭킹 (Gemini 미사용)
후보별 점수(모두 코드로 계산, 튜닝 상수는 `config.js`):

```
score = (등장한 검색식 수 × 10)        // 중복 출현 = 핵심 신호
      + (법원 가중치: 대법원 5, 헌재 5, 고법 3, 기타 1)
      + (선고일 최신순 타이브레이커: 0~1)
```

- 상위 `CANDIDATE_MAX`(기본 20)건만 후보로 남긴다.
- 후보가 0건이면 Gemini 호출 ②를 생략하고 "찾지 못함" 응답(§3-A5)으로 종료한다. — 이 경우 질문당 Gemini 호출은 1회.

#### 단계 4. Gemini 호출 ② — 후보 내 선별
- 입력: 사용자 질문 + 후보 목록(각 후보: 사건번호, 사건명, 선고일, 법원, 판시사항 앞 300자). 검색 결과 원문 전체를 넣지 않는다 — TPM 예산 관리(§9).
- 출력(responseSchema로 강제, **selected의 사건번호는 후보 목록의 enum으로 제한**):

```json
{
  "selected": [
    { "case_no": "후보 중 하나", "match": "direct | related" }
  ],
  "intro": "결과 상단에 붙일 1~2문장 안내문 (사건번호·조문번호 인용 금지)"
}
```

- `selected`는 최대 `RESULT_MAX`(기본 5)건. 관련성이 낮으면 빈 배열도 허용 — 그 경우 결정론 랭킹 상위 3건을 `related`로 대체 표기.
- 스키마의 enum 제한이 동작하지 않는 환경이더라도, validator(§7)가 후보 밖 사건번호를 전부 걸러낸다. 이중 방어.

#### 단계 5. 상세 조회 및 관련법규 구성 (Gemini 미사용)
- `selected` 각각에 대해 `get_decision_text`(기본 축약 모드)로 전문 조회 → 판시사항·판결요지·참조조문·상세링크 확보.
- 참조조문들을 dedupe한 뒤 상위 `LAW_MAX`(기본 4)개 조문에 대해 `get_law_text`로 조문 원문을 조회 → 「관련법규」 섹션 재료. 참조조문이 없으면 단계 2에서 확보한 `search_law` 결과의 법령을 사용하되, 조문 특정이 안 되면 법령명만 표시하고 내용은 비워둔다(지어내지 않는다).

#### 단계 6. 검증(§7) → 렌더링(§8)

### 6.2 Legacy 모드 A — 에이전틱 검색 (`gemini_a6`)

이 경로는 제품 UI에 노출하지 않고 benchmark/regression/debug 용도로만 보존한다. M9 이후 prompt, search policy, reasoning 설정을 재튜닝하지 않는다.

Gemini 함수 호출(function calling) 루프로 구현한다.

- **노출 도구(화이트리스트)**: `search_decisions`, `search_law`, `get_law_text`, `get_decision_text`(축약 모드 고정) 4개만 함수 선언으로 노출한다. `execute_tool` 등 프록시성 도구는 노출 금지 — 도구 공간이 무한히 열리면 검증이 불가능해진다.
- **루프**: 사용자 질문 + 도구 선언 + `prompts/agent.txt`(시스템 지침)로 시작. 모델이 함수 호출을 반환하면 앱이 mcpClient로 실행해 결과를 돌려준다. 모델이 최종 답(아래 스키마)을 반환하거나 질문당 Gemini 요청 수가 `AGENTIC_CALL_MAX`(기본 6)에 도달하면 종료한다.
- **최종 답 스키마**: 모드 D의 호출 ②와 동일한 JSON(`selected[{case_no, match}]` + `intro`). 자유 서술형 최종 답은 받지 않는다.
- **닫힌 선택의 적용 방식**: 앱은 루프 동안 도구 결과에 실제로 등장한 사건번호를 전부 수집해 두고, 이 집합을 validator에 후보 집합으로 넘긴다. 최종 답의 사건번호가 이 집합 밖에 있으면 제거된다(A2·A3).
- **도구 결과 구조화**: 검색 도구 결과는 `total`과 `items[{id, caseNumber, title, court, date, ...}]` 구조로 전달하고, 판례 상세는 `caseNumber`, 메타데이터와 `판시사항`·`판결요지`·`결정요지`·`재결요지` 등 필요한 요지만 구조화해 전달한다. 원시 MCP 문자열을 임의의 문자 수로 절단하지 않으며, 최종 출력의 원문 필드는 6.1 단계 5와 동일하게 앱이 재조회한 원문을 쓴다(A1).
- **실험 기록 분리**: 에이전틱 결과에는 `raw_agent_candidates`, `raw_agent_selection`, `agent_stop_reason`, `fallback_used`, `final_product_output`을 별도로 기록한다. `fallback_used`가 참인 경우 결정론 후보 폴백과 상위 랭킹 채움 사유를 구분한다. 에이전틱 arm 간에는 이 tool surface를 공유하고 질문당 호출 상한만 설정으로 다르게 한다.
- **상한 도달 시**: 최종 답 없이 상한에 닿으면, 루프 중 수집된 검색 결과에 6.1 단계 3의 결정론 랭킹을 적용해 A7 폴백 형식으로 출력한다.
- **prompts/agent.txt 요지**: "도구 결과에 없는 판례·조문을 절대 언급하지 마라. 찾지 못했으면 selected를 비워라. 검색어를 바꿔가며 여러 번 검색하라. 판단·자문하지 마라."

### 6.3 제품 Luna Native (`luna_native`)

Luna 제품 구성은 모델 단독이 아니라 다음 전체 configuration이다.

```text
GPT-5.6 Luna medium
→ persistent Codex native session
→ restricted korean-law MCP
→ per-question EvidenceLedger
→ FinalSelectionGate
→ verified-only result contract / renderer
```

- adapter가 `provider=Codex/Luna`, `architecture=Native AO-v2`, `model=gpt-5.6-luna`, `reasoning=medium`을 실행 시점에 고정한다. 환경변수 충돌로 다른 runtime이 선택되면 요청을 중단한다.
- 노출 legal tool은 `search_decisions`, `get_decision_text`, `search_law`, `get_law_text`뿐이다. `shell`, command execution, web/browser, repo/file inspection, Git/GitHub 및 unrelated MCP는 금지한다.
- 모든 검색·상세 조회 evidence는 질문별 `EvidenceLedger`에 기록한다. `provider search observed` + `provider detail opened` + `detail identity verified`를 모두 만족한 item만 최종 result에 포함한다.
- native final selection의 `unverified`, `not observed`, `invalid match`는 reject하고 duplicate는 dedupe한다. compound 사건번호는 raw provider evidence에서 확인한 verified member/alias만 보존한다.
- Luna 실행 실패 시 Gemini로 몰래 전환하지 않는다. 검색 실패 상태와 다른 adapter 선택 안내를 반환한다.
- Native 모델의 private reasoning, system prompt, raw tool planning, 인증 토큰은 UI·로그·admin에 노출하지 않는다.

### 6.4 제품 공통 규칙

- Gemini 요청에 temperature 등 생성 파라미터를 설정하지 않는다(§3-A6).
- 제품 adapter 모두 최종 selection 이후의 상세 조회·관련법규 구성과 renderer/validator 규칙을 공유한다.
- 최종 결과는 adapter가 반환한 verified `result.items`를 표시한다. raw search candidate 전체를 추가로 detail-open한다는 의미는 아니다.
- quota 정보는 UX 표시용으로만 사용하며 validator와 결합하지 않는다.

### 6.5 M9 비교 평가 및 제품 구성 확정

M9 Blind-30은 30문항 × `gemini_d` / `gemini_a6` / `luna_native` = 90 records로 실행했다. 비교 결과는 다음과 같다.

| arm | question wins | DIRECT-hit Q | usable | broad usable | irrelevant |
|---|---:|---:|---:|---:|---:|
| Gemini D | 6 | 13/30 | 37 | 47 | 28.4% |
| Gemini A6 (legacy) | 5 | 18/30 | 28 | 41 | 10.9% |
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

따라서 제품 검색 구성은 다음 두 가지로 확정한다.

```text
gemini_d
= 빠른 / 경량 / Gemini API 기반

luna_native
= 고정밀 / Codex ChatGPT quota 기반 / safety-gated Native AO-v2
```

`gemini_a6`와 Gemini AO-v2의 제품 후보 연구는 종료한다. M10에서는 새 blind set, 새 model benchmark, D prompt/ranking/query/selector 변경, Luna prompt/search policy/tool/reasoning 변경을 하지 않는다.

---

## 7. Route B — 사건번호 직접 조회 (directLookup.js) 및 검증 계층 (validator.js)

### 7.1 directLookup
- 정규화된 사건번호로 `search_decisions(domain, query=사건번호)` → 정확 일치 항목의 ID 획득 → `get_decision_text`로 전문 조회.
- LLM은 0회 호출한다. 안내문도 고정 문구를 쓴다.
- 미존재 사건번호는 다음 primary 문구로 응답한다: "해당 사건번호의 판결을 국가법령정보센터에서 찾지 못했습니다. 사건번호가 정확한지 다시 확인해 주세요."
- 보조 안내는 다음과 같이 표시할 수 있다: "국가법령정보센터에 수록되지 않았거나 공개 범위가 다른 판결은 대한민국 법원의 판결서 인터넷열람 또는 판결서사본 제공신청에서 확인할 수 있는 경우가 있습니다." 검색되리라고 단정하지 않는다.
- 공식 법원 안내 helper는 형사 `2013-01-01 이후 확정 판결서`, 민사·행정·특허 `2015-01-01 이후 확정 또는 2023-01-01 이후 선고` 범위를 안내할 수 있다. 이 범위에 해당하면 반드시 검색된다고 단정하지 않는다.
- 실패 화면에는 공식 법원 안내 CTA(`[판결서 인터넷열람 안내]`, `[판결서사본 제공신청]`)를 제공할 수 있다.
- 전문(full) 보기: 결과 화면에 "전문 보기" 링크를 두되 법령센터 상세링크로 보낸다. 앱이 full 텍스트를 다시 받아 렌더링하는 기능은 MVP 제외.

### 7.2 validator (두 라우트 공통, 렌더링 직전 실행)
1. 출력 예정 데이터의 모든 사건번호가 후보 집합에 존재하는지 확인. 후보 집합의 정의: `gemini_d` = 단계 3의 후보 목록, `gemini_a6` = 루프 중 도구 결과에 등장한 사건번호 전체, `luna_native` = EvidenceLedger의 provider-observed 사건번호 전체, Route B = 사용자 입력값.
2. 각 사건번호의 `get_decision_text` 성공 여부 확인. `[NOT_FOUND]` / `[HALLUCINATION_DETECTED]` 마커 포함 응답은 실패로 간주.
3. 모델이 쓴 `intro` 문장 안에 사건번호 패턴(§5.1)이나 "제n조" 패턴이 있으면, 그것이 검증된 목록에 없을 경우 해당 문구를 제거한다.
4. 실패 항목은 `logs/validation.log`에 (일시, 질문, 사건번호, 사유) 기록.
5. 최종 표시 item은 provider search observed + provider detail opened + detail identity verified를 모두 만족해야 한다. compound case number의 임의 sibling은 `CASE_NOT_OBSERVED`로 거부한다.

---

## 8. 출력 템플릿 (renderer.js)

최종 화면은 아래 구조를 따른다 (사용자 제공 양식 기준):

```
[사용자 질문 원문]

(intro 1~2문장 — Route A만, 없으면 생략)

관련법규
  ○○법 제○조 : (조문 내용 — get_law_text 원문)
  △△법 제△조 : (조문 내용)

관련판례
  2020다12345 (사건번호 = 법령센터 상세링크)
    판시내용 : (판시사항 원문)
    판결요지 : (판결요지 원문)
  2021두6789 (링크)
    판시내용 : ...
    판결요지 : ...
```

규칙:
- adapter final result에 포함되고 detail verification까지 성공한 **모든 verified item**을 표시한다. renderer-level `DETAIL_MAX`로 하위 결과의 판시사항·판결요지를 숨기지 않는다.
- 각 판례 카드에는 사건번호+공식 링크, 사건명, 법원, 선고일, 관련성 label, 판시사항, 판결요지·결정요지를 포함한다.
- `match=related`만 있는 경우 섹션 제목을 「관련판례 (질문과 정확히 일치하는 판례는 찾지 못했습니다)」로 바꾼다.
- 판시사항·판결요지가 API 응답에 없는 판례(하급심 등)는 "판결요지 : (법령센터 원문 참조)"로 표기하고 링크로 대신한다. 요약을 생성해 채우지 않는다.
- 렌더러는 검증 완료된 데이터 객체 → HTML 문자열의 **순수 함수**로 작성한다. 렌더러 안에서 네트워크 호출·LLM 호출 금지.
- 관련 법령은 기본 접힘(native `<details>` 권장)으로 표시한다. 조문 제목은 provider에서 확인된 경우에만 표시하고, 확장 시 provider에서 취득한 조문 전문을 보여준다.
- 하단 고정 푸터: "본 결과는 법제처 국가법령정보 Open API 데이터를 그대로 표시한 것으로, 법률 자문이 아닙니다."

---

## 9. Gemini·Codex quota 관리 (QuotaService / rateLimiter.js)

기준 한도: **RPM 15 / 입력 TPM 250K / RPD 500** — **운영자가 직접 확인 완료(2026-08-10, 확정값)**. 향후 Google의 한도 변경 공지가 있을 때만 재확인한다.

앱 내부 한도는 가끔 벌어질 수 있는 사태(동시 사용, 재시도, 카운터 오차)를 흡수하도록 공식 한도보다 보수적으로 잡는다:

| 항목 | 공식(확정) | 앱 내부 한도 |
|---|---|---|
| RPM | 15 | **13** |
| RPD | 500 | **450** → Gemini D(2회/질문) 약 225질문/일 |
| 요청당 입력 토큰 | (TPM 250K) | Gemini D: 호출 ① ≤ 2K, 호출 ② ≤ 15K (후보 20건 × 요약 300자 수준) |

구현:
- 단순 토큰버킷 + 일일 카운터. 상태는 `state/usage.json` 파일에 저장(재시작 후에도 유지). 일일 카운터 리셋 기준 시각은 태평양 시간 자정(Google 기준)으로 한다.
- legacy 모드 A의 질문당 호출 상한(`AGENTIC_CALL_MAX`)도 rateLimiter가 강제한다 — 루프 코드 버그로 상한이 뚫리는 것에 대한 이중 방어.
- 한도 초과 시: 대기열에 넣지 말고 즉시 "오늘의 AI 분석 한도에 도달했습니다" + 결정론 랭킹 결과만 표시(§3-A7).
- Gemini 429 수신 시: 1회만 20초 후 재시도, 그래도 실패하면 A7 폴백. Luna native session 실패는 P-A7에 따라 다른 adapter로 자동 전환하지 않는다.
- TPM 방어: 후보 요약은 항상 잘라서 넣고, `get_decision_text`는 축약 모드(기본값)만 사용한다. `full=true`는 어떤 경로에서도 Gemini 입력에 넣지 않는다.

법제처 API 쪽은 무제한이지만 동시성 5, 요청 간 지연 없음, 실패 시 2회 재시도 정도로 예의를 지킨다.

### 9.1 Quota abstraction 및 UI 정책

```text
QuotaService
├─ CodexQuotaProvider
│  └─ App Server: account/rateLimits/read
└─ GeminiQuotaProvider
   ├─ CloudMonitoring
   └─ LocalEstimator
```

- Codex quota는 `usedPercent`, `windowDurationMins`, `resetsAt`, `rateLimitReachedType`를 사용한다. `remaining = 100 - usedPercent`로 계산하며 "5시간/주간"을 코드에 hard-code하지 않는다.
- App Server를 사용할 수 없으면 `Luna 사용량 확인 불가`로 degrade한다. quota 조회 실패가 서버 시작이나 검색 기능을 막아서는 안 된다.
- Gemini는 GCP Monitoring 인증이 있으면 project quota metric을 사용하고, 없으면 기존 local counter를 사용하되 반드시 `로컬 추정`으로 표시한다. 다른 앱의 같은 project 사용량은 local estimate에 반영되지 않을 수 있음을 안내한다.
- quota는 UX 정보이며 validator와 결합하지 않는다.
- 검색 화면 상태 영역에는 adapter 표시명, 법령 API 상태, Gemini quota, Luna quota를 간단히 표시한다. raw token, secret, private reasoning은 표시하지 않는다.

---

## 10. 디렉토리 구조

```
case-finder/
├── start.bat              # npm ci 여부 확인 → node src/server.js → 브라우저 열기
├── package.json           # 정확 버전 고정
├── package-lock.json
├── .nvmrc
├── .env.example           # LAW_OC=, GEMINI_API_KEY=
├── README.md              # 설치·실행·키 발급 (비개발자 대상, 스크린샷 수준으로 상세히)
├── AGENTS.md              # AI 작업자용: 이 명세서 요약 + 정확성 계약 전문 재수록
├── config.js              # 모델명, 상수(CANDIDATE_MAX 등), 한도값 — 튜닝은 여기서만
├── prompts/
│   ├── plan.txt           # 모드 D 호출 ① 프롬프트
│   ├── select.txt         # 모드 D 호출 ② 프롬프트
│   └── agent.txt          # legacy A6 시스템 지침
├── public/
│   ├── index.html         # 검색 화면
│   ├── app.js             # stream/progress/status UI
│   └── styles.css         # 가벼운 정적 스타일
├── src/
│   ├── server.js          # http 서버, 라우팅 (GET /, POST /ask, POST /ask/stream, /admin)
│   ├── router.js          # §5
│   ├── directLookup.js    # §7.1
│   ├── nlPipeline.js      # §6
│   ├── mcpClient.js       # korean-law-mcp stdio 클라이언트 (기동·재기동·호출 래퍼)
│   ├── codexNativeSession.js # Luna persistent native session
│   ├── aoV2/evidenceLedger.js   # 질문별 provider evidence 저장
│   ├── aoV2/finalSelectionGate.js # Luna 및 공통 최종 선택 검증
│   ├── aoV2/legalToolGateway.js # restricted legal MCP surface
│   ├── gemini.js          # @google/genai 래퍼 (responseSchema·함수호출, 생성 파라미터는 기본값)
│   ├── rateLimiter.js      # Gemini local limiter
│   ├── quotaService.js     # Codex/Gemini quota abstraction (§9)
│   ├── admin.js            # whitelist 설정·상태 API, secret 비반환
│   ├── validator.js       # §7.2
│   └── renderer.js        # §8
├── state/                 # usage.json (gitignore)
└── logs/                  # validation.log, error.log (gitignore)
```

- 파일당 200줄 이내를 목표로 한다. 넘어가면 분리보다 먼저 "기능을 빼야 하는 것 아닌지" 검토한다.
- 외부 의존성 총량 목표: 4개 이하 (`korean-law-mcp`, `@modelcontextprotocol/sdk`, `@google/genai`, `dotenv`).

### mcpClient.js 요구사항
- 앱 기동 시 `korean-law-mcp`를 자식 프로세스(stdio)로 1회 띄우고 재사용한다. env로 `LAW_OC` 전달.
- 프로세스 사망 감지 시 1회 자동 재기동, 연속 실패 시 명확한 에러 화면("법령 서버 기동 실패 — README의 문제해결 절 참조").
- 모든 도구 호출은 `callTool(name, args, timeoutMs)` 한 함수로 감싸고, 타임아웃 기본 30초.

### Native session 및 admin 요구사항
- `luna_native`는 질문별 persistent Codex native session을 사용하되, 질문 간 EvidenceLedger와 사용자 결과는 분리한다.
- `/admin`은 localhost 전용이며 same-origin only, CORS disabled, JSON only, whitelist only로 write를 제한한다.
- 허용 설정은 `SEARCH_ADAPTER`, `GEMINI_API_KEY`, `LAW_OC`, `CODEX_CLI_PATH`, `CODEX_TIMEOUT_MS`, `GCP_PROJECT_ID`다. 실제 secret 값은 GET 응답에 반환하지 않고 configured 여부만 표시한다.
- `.env` 저장은 atomic write를 권장하며, 초기 제품은 저장 후 "서버 재시작 후 적용됩니다."를 표시한다.
- streaming endpoint는 `POST /ask/stream`, `Content-Type: text/event-stream`을 사용하고 별도 DB/WebSocket/search-task server를 만들지 않는다.

---

## 11. 환경 설정

`.env` (커밋 금지, `.env.example`만 커밋):

```
LAW_OC=발급받은_법제처_인증키        # open.law.go.kr → Open API 사용 신청 (무료, 즉시)
GEMINI_API_KEY=발급받은_키          # aistudio.google.com → Get API key (free tier)
SEARCH_ADAPTER=gemini_d              # gemini_d 또는 luna_native
CODEX_CLI_PATH=                      # luna_native용 Codex native runtime 경로
CODEX_TIMEOUT_MS=120000
GCP_PROJECT_ID=                      # 선택: Gemini Cloud Monitoring quota 조회
PORT=3000
```

README에 키와 Codex runtime 설정 절차를 단계별로 기술할 것 (법제처: open.law.go.kr 회원가입 → Open API 사용 신청 → 인증키(OC) 확인. Gemini: Google AI Studio에서 발급, **결제수단 등록 금지** — 등록하면 유료 티어로 전환될 수 있음을 경고). `SEARCH_ADAPTER`는 제품 dropdown과 동일하게 `gemini_d` 또는 `luna_native`만 허용한다.

---

## 12. 구현 마일스톤

각 마일스톤은 독립적으로 동작 확인이 가능해야 하며, 순서를 바꾸지 않는다.

- **M0 — 골격**: 디렉토리 구조, start.bat, http 서버, index.html 정적 페이지, mcpClient 기동·`search_law("민법")` 1회 성공 로그.
- **M1 — Route B 완성**: 사건번호 입력 → 직접 조회 → 템플릿 렌더링. **Gemini 없이** 전체 출력 양식(§8)이 완성되는 것이 목표. 미존재 사건번호의 정직한 실패 포함.
- **M2 — 모드 D(결정론 파이프라인)**: 검색 계획(호출 ①) → 병렬 검색 → 결정론 랭킹 → 선별(호출 ②) → 상세 조회 → 렌더링.
- **M3 — 방어 계층**: validator, rateLimiter, A7 폴백, 로그. (모드 비교의 전제조건 — 정확도 측정은 validator 없이는 무의미하다.)
- **M4 — 모드 A(에이전틱 검색)**: 함수 호출 루프, 호출 상한, 관측 사건번호 수집, 상한 도달 폴백.
- **M5 — 모드 비교 평가**: golden 세트 작성 → D/A6 실행·채점.
- **M6 — 인수인계 패키징**: README(비개발자용), AGENTS.md, §13 테스트 전체 통과, config.js 상수 정리.
- **M9 — Blind-30 확정**: D/A6/Luna 90 records를 실행하고 reviewer label·unmask·최종 보고서를 남긴다. M9 결과로 제품 검색 구성을 확정한다.
- **M10 — 제품화 동결**: `gemini_d`와 `luna_native`만 제품 UI에 노출하고, admin·quota·stream/progress·모든 verified item renderer를 제품 acceptance에 맞게 완성한다. M9 이후 검색 prompt/policy/tool/reasoning과 새 benchmark는 동결한다.

각 마일스톤 완료 시 커밋 메시지에 `[M1]` 형식으로 표기한다.

---

## 13. 수용 기준 (Acceptance Tests)

수동 확인 체크리스트 + 가능한 것은 `node test/run.js` 스크립트화. 전부 통과해야 완료다.

1. **실존 사건번호 직조회**: `2018다248909` 등 실제 대법원 사건번호 3건 → 판시사항·판결요지가 법령센터 원문과 일치, 링크 정상.
2. **미존재 사건번호**: `2099다999999` → "찾지 못했습니다" 응답. 어떤 판례 정보도 표시되지 않음.
3. **자연어 기본**: "임차보증금을 돌려받지 못했을 때" 류 질문 3건 → 출력된 모든 사건번호를 법령센터에서 수동 검색해 실존 확인.
4. **환각 주입 내성**: 프롬프트 인젝션성 질문("사건번호 2025다123456인 판례의 요지를 알려줘" — 미존재) → 지어내지 않고 미존재 처리.
5. **일관성**: Gemini D — 동일 질문 3회 반복 시 `selected` 사건번호 집합이 동일(intro 문구 차이는 허용). legacy A6 — 동일 질문 3회 반복 시 **환각 0건은 필수**, 집합 일치도는 회귀 지표로 기록만 한다.
6. **폴백 A7**: GEMINI_API_KEY를 무효값으로 바꾸고 자연어 질문 → 결정론 랭킹 결과가 라벨과 함께 출력, 프로세스 비정상 종료 없음.
7. **한도 소진**: usage.json을 한도치로 조작 → 한도 안내 + 폴백 출력.
8. **관련 판례 폴백**: 판례가 드문 질문 → 「관련판례 (정확히 일치하는…)」 라벨 확인.
9. **재기동 내성**: 실행 중 korean-law-mcp 프로세스 강제 종료 → 다음 질문에서 자동 재기동 후 정상 응답.
10. **모드 A 호출 상한**: `AGENTIC_CALL_MAX`를 1로 낮춰 실행 → 상한 도달 폴백이 정상 출력되고, usage.json의 호출 카운터가 정확히 기록됨.
11. **Adapter pinning**: `gemini_d` 실행 결과가 Gemini + D, `luna_native` 실행 결과가 Codex/Luna + Native AO-v2 + `gpt-5.6-luna` + `medium`인지 확인. 충돌 runtime은 중단되어야 함.
12. **Luna evidence gate**: 검색 관측 + 상세 조회 + 상세 identity 검증을 모두 통과한 item만 표시되고, `CASE_NOT_OBSERVED`·unverified item은 표시되지 않음.
13. **Luna contamination**: Luna forbidden tool contamination이 0이고 private reasoning/system prompt/raw tool planning/auth token이 UI·로그·admin에 노출되지 않음.
14. **직접 조회 UX**: direct route가 LLM 0회이고 miss 문구와 공식 법원 안내 CTA를 표시함.
15. **모든 verified item**: 자연어 결과가 adapter final result의 모든 verified item에 대해 사건번호, 사건명, 법원, 선고일, 관련성, 판시사항, 판결요지·결정요지와 공식 링크를 표시함.
16. **Streaming/progress**: `/ask/stream` final event가 기존 `/ask` 결과와 동일하고, 실제 host event만으로 monotonic progress를 표시하며 1초 이내 완료 시 상세 loading UI를 숨김.
17. **Quota degrade**: Codex/Gemini quota 조회 실패가 검색을 막지 않고, 각각 `사용량 확인 불가` 또는 `로컬 추정`으로 표시됨.
18. **Admin safety**: `/admin`이 `127.0.0.1`에서만 접근되고 same-origin/CORS-disabled/JSON-only/whitelist-only write를 적용하며 GET 응답에 secret 원문이 없음.

---

## 14. 로깅

- `logs/error.log`: 모든 예외 (스택 포함).
- `logs/validation.log`: validator가 제거한 항목 전부. **이 로그가 비어있는 상태가 정상 운영이다.** 항목이 쌓이면 프롬프트나 랭킹에 문제가 생겼다는 신호.
- 개인정보·API 키는 로그에 남기지 않는다 (korean-law-mcp도 URL 내 OC 마스킹을 자체 수행하지만, 앱 로그에서도 동일 원칙).

---

## 15. 사용자 화면 (public/index.html)

- 구성: 제목, 입력창 1개, 검색 버튼, 결과 영역, adapter·API·quota 상태 영역, 하단 푸터(§8).
- `LOADING_UI_THRESHOLD_MS=1000`: 1초 안에 끝나면 상세 loading UI를 표시하지 않는다.
- `/ask/stream`을 사용할 경우 실제 host event 기반으로만 progress를 표시한다. progress는 monotonic indicator이며 ETA가 아니다.
- 허용 progress 정보: 후보 수, 검증된 판례 수, 확인된 관련 법령 수, 현재 단계. raw query, tool args, system prompt, chain-of-thought는 표시하지 않는다.
- 예시 단계: `질문 분석` → `관련 법령 확인` → `판례 후보 검색` → `판례 원문 검증` → `결과 정리`.
- 결과 내 사건번호는 `<a target="_blank">` 링크.
- JS는 바닐라, fetch로 POST /ask 호출. 빌드 도구(웹팩 등) 도입 금지.

---

## 16. 향후 확장 후보 (MVP에서 구현하지 않음, 코드에 자리만 남기지도 않음)

- 최종 결과 캐시 (동일 질문 재사용) — korean-law-mcp 자체 캐시(검색 1h, 조문 24h)가 있으므로 MVP에선 불필요
- 검색 이력 저장, 결과 내보내기(hwp/pdf)
- `verify_citations` / `legal_analysis` 도구를 이용한 외부 문서 인용 검증 기능
- 조문 개정이력·신구대조 표시

---

## 17. 유지보수·인수인계 규칙

### 17.1 변경 금지 사항 (사람의 명시적 승인 없이 AI 작업자가 바꿀 수 없음)
- 정확성 계약(§3) 전체
- M9에서 확정된 제품 검색 구성(`gemini_d` + `luna_native`) 및 adapter pinning
- `gemini_d`의 prompt/ranking/query/selector, `luna_native`의 prompt/search policy/tool/reasoning 설정
- `gemini_a6` legacy 경로를 제품 UI에 노출하거나 재튜닝하는 변경
- 원문 전용 필드에 대한 LLM 텍스트 주입
- EvidenceLedger, FinalSelectionGate, restricted legal tool surface, verified-only renderer를 우회하는 변경
- 버전 고정 정책(§2) — 특히 `@latest` 도입
- Gemini 유료 티어 전환, 결제수단 등록

### 17.2 버전 업그레이드 절차 (연 1~2회 권장)
1. 브랜치 분리 → 대상 패키지 1개만 버전 변경 → `npm ci`
2. korean-law-mcp를 올릴 경우: 기동 후 도구 목록을 덤프해 이 문서 §18-A의 목록과 비교. 이름·스키마 변경이 있으면 mcpClient 호출부를 맞추고 §18-A 갱신.
3. §13 수용 기준 전체 재실행 → 통과 시에만 병합.
4. Gemini 모델이 지원 종료(deprecation) 공지되면: 후보 모델로 모델 문자열만 바꾼 브랜치에서 §13의 5번(일관성)을 반드시 3회 이상 반복 확인 — 모델 교체 시 선별 결과가 흔들리는 문제가 과거에 관측되었다.

### 17.3 문서 동기화
- 코드 동작과 이 문서가 어긋나면 **문서를 갱신하는 커밋을 같은 PR에 포함**한다.
- AGENTS.md에는 "이 명세서를 먼저 읽어라"를 첫 줄에 둔다.

---

## 18. 구현 시 확인이 필요한 미확정 사항 (착수 시 반드시 해소하고 본 문서 갱신)

- **A. (확인 완료, 2026-08-11) korean-law-mcp 고정 버전과 도구 목록**: `package.json`과 lockfile은 `korean-law-mcp` `4.9.6`으로 고정되어 있으며, 실제 기동 시 도구 10개를 확인했다 — `search_law`, `get_law_text`, `get_annexes`, `search_decisions`, `get_decision_text`, `legal_research`, `legal_analysis`, `ordinance_radar`, `discover_tools`, `execute_tool`. 제품이 노출하는 Gemini 도구는 이 중 4개(`search_decisions`, `search_law`, `get_law_text`, `get_decision_text`)로 제한한다. 버전 업그레이드 시 §17.2 절차를 다시 따른다. (공식 저장소: https://github.com/chrisryugj/korean-law-mcp)
- **B. (확인 완료, 2026-08-10)** `search_decisions` 응답의 `링크` 필드는 `/DRF/lawService.do` API URL이며, `target=prec`와 API 일련번호를 확인한 뒤 사용자 화면에서는 `https://www.law.go.kr/LSW/precInfoP.do?precSeq=<ID>`로 변환한다. `2018다248909`의 `ID=205791` 고정 URL을 실제 브라우저에서 열어 사건 본문을 확인했다. 법령 검색 응답의 `MST`는 `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=<MST>`로 변환하며, `MST=284415`에서 민법 본문과 제393조를 확인했다. 인증키(`OC`)는 사용자 링크에 포함하지 않는다.
- **C. (확인 완료, 2026-08-10)** Gemini free tier 한도: RPM 15 / 입력 TPM 250K / RPD 500 — **운영자가 직접 확인한 확정값**. 앱 내부 한도는 RPM 13 / RPD 450(§9). 추가 확인 작업 불필요하며, 향후 Google의 한도 변경 공지가 있을 때만 §9와 `config.js`를 갱신할 것.
- **D. `@google/genai` responseSchema에서 enum 동적 주입 가능 여부**: 호출 ②의 사건번호 enum 제한이 SDK에서 정상 동작하는지 확인. 불가하면 validator만으로 방어(이미 설계에 포함).
- **E. 사건부호 → 도메인 매핑 표**: §5.1의 매핑을 실제 조회 테스트로 보강할 것 (행정심판·조세심판 계열 사건번호 체계 포함 여부 결정).
- **F. Codex quota provider**: App Server의 `account/rateLimits/read` structured RPC 연결과 unavailable degrade를 제품 acceptance 전에 확인한다. window duration/reset 시각을 실제 응답으로 표시해야 한다.
- **G. Gemini quota provider**: GCP Monitoring 인증 경로와 인증 부재 시 local estimator 표기의 실제 동작을 제품 acceptance 전에 확인한다.
- **H. Streaming/admin UI**: `/ask/stream`, monotonic host progress, localhost-only whitelist admin write와 secret 비반환을 제품 acceptance 전에 확인한다.

---

## 참고 자료

- korean-law-mcp 저장소: https://github.com/chrisryugj/korean-law-mcp (npm: `korean-law-mcp`)
- 법제처 Open API 신청: https://open.law.go.kr/LSO/openApi/guideList.do
- Gemini 3.5 Flash-Lite 공식 문서: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- Gemini rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- MCP 사양: https://modelcontextprotocol.io

*문서 버전 v2.0-M9 — 2026-08-13. M9 Blind-30 결과와 Product Spec v2.0을 반영했다.*
*v2.0-M9 (2026-08-13): 최종 제품 검색 구성을 `gemini_d` + `luna_native`로 확정하고 A6를 legacy로 전환했으며, Luna evidence gate, verified-only renderer, quota/admin/streaming/progress 정책을 반영.*
*v1.1 (2026-08-10): 생성 파라미터(temperature 등) 미설정으로 변경, 결정론/에이전틱 2모드 구현 + 비교 평가 체계 도입(§4, §6, §12), Gemini quota 확정값 반영 및 내부 한도 RPM 13/RPD 450 조정(§9, §18-C).*
*v1.0 (2026-08-10): 최초 작성.*
*v1.1-24.14.0 (2026-08-10): 실행 환경을 Node.js 24.14.0으로 변경.*
*v1.1-M1 (2026-08-10): 사건번호 직접 조회(Route B), 원문 검증·템플릿 렌더링·미존재 처리와 법령센터 상세 링크 변환을 구현.*
*v1.1-M2 (2026-08-10): 모드 D 자연어 검색계획·병렬 MCP 검색·결정론 랭킹·후보 내 선별·상세 검증·렌더링을 구현.*
*v1.1-M3 (2026-08-10): validator·rateLimiter·429 1회 재시도·A7 결정론 폴백·사용량 및 검증 로그를 구현.*
*v1.1-M4 (2026-08-11): 모드 A 에이전틱 함수 호출 루프·화이트리스트 도구·호출 상한·도구 결과 절단·관측 사건번호 닫힌 선택·상한 폴백을 구현.*
*v1.1-M5-start (2026-08-11): 핵심 회귀 golden 세트와 무의존성 검증 러너를 추가하고 모드 비교 평가를 착수.*
*v1.1-M5-1-2 (2026-08-11): 사건번호 병합·축약 표기의 구조적 비교와 본문검색 강제(search=2), 자연어 후보 표시 수 20건을 적용.*
*v1.1-M5-3-5 (2026-08-11): 검색계획의 admin_appeal 도메인 정합화, 골든의 구조적 사건번호 비교, preview 부재 후보의 보수적 재랭킹 감점을 적용.*
*v1.1-M6C (2026-08-12): D/A6/AO 30문항 screening 결과와 제품 모드 미확정 상태를 기록하고, korean-law-mcp 4.9.6 및 실제 도구 목록 확인 결과를 반영.*
