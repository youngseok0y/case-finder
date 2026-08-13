# CASE-FINDER HANDOFF M9
## Pluggable Adapters + New Blind-30 Three-Arm Benchmark Prep

> **현재 환경 목표:** A Fix → 플러그형 adapter → Blind-30 실행 인프라 → QA → commit/push → STOP
> **새 환경 목표:** 신규 30문항 작성/freeze → D/A6/Luna Native 90-run → blind review → unmask
>
> Repository: `youngseok0y/case-finder`
> Base branch: `m8-provider-native-ao-v2`
> Base remote HEAD: `2b56d19c6d85f11dd1edc3a27e631db82b5d0770`
> New branch: `m9-three-arm-blind30-prep`

---

# 1. M9에서 비교할 최종 제품 configuration

세 arm만 사용한다.

### G-D
- adapter_id: `gemini_d`
- 기존 Gemini Flash-lite
- 기존 deterministic D
- 기존 planner/search/ranking/selector/validator 유지

### G-A6
- adapter_id: `gemini_a6`
- 기존 Gemini Flash-lite
- **기존 A6 pipeline / Gemini native function-calling adapter**
- M8 Gemini AO-v2 사용 금지

### L-NATIVE
- adapter_id: `luna_native`
- `gpt-5.6-luna`
- reasoning=`medium`
- persistent Codex native session
- restricted legal MCP
- M8 EvidenceLedger / FinalSelectionGate / source-grounding 계약 유지
- shell/web/repo/GitHub 금지

이번 blind는 순수 모델 비교가 아니라 **실제 제품에서 제공할 세 configuration 비교**다.

---

# 2. 제품 구조 원칙 — “호환 adapter”가 아니라 “갈아 끼우는 adapter”

잘못된 구조:

```text
MODEL + MODE
→ 하나의 공통 agent protocol
```

목표:

```text
Case Finder
    │
SearchAdapterRegistry
    ├─ gemini_d
    ├─ gemini_a6
    └─ luna_native
           │
     Common Result Contract
           │
   Evidence / Validator / UI
```

각 adapter는 내부 orchestration을 공유할 필요가 없다.

공통 interface는 최소화한다.

```js
{
  id,
  provider,
  architecture,
  async runNaturalQuery(query, options)
}
```

공통화할 것은:
- result schema
- source verification
- telemetry
- error contract

공통화하지 않을 것은:
- agent turn format
- native tool-call format
- session persistence
- provider-specific continuation

권장 파일:

```text
src/searchAdapters/
  registry.js
  resultContract.js
  geminiDAdapter.js
  geminiA6Adapter.js
  lunaNativeAdapter.js
```

기존 D/A6/Luna 구현은 우선 **thin wrapper**로 감싼다. 대규모 rewrite 금지.

환경 설정:

```text
SEARCH_ADAPTER=gemini_d
SEARCH_ADAPTER=gemini_a6
SEARCH_ADAPTER=luna_native
```

unknown ID:

```text
SEARCH_ADAPTER_UNSUPPORTED
```

---

# 3. A Fix — Compound Case Evidence Identity

M8 Luna audit에서 strict accuracy에 실제 영향을 준 grounding failure 1건:

```text
related-platform-union-worker

provider verified raw detail:
2014두12598, 12604

ledger key:
2014두12598

model final:
2014두12598, 12604

→ CASE_NOT_OBSERVED
→ strict miss
```

이것은 단순 hallucination만이 아니라 **verified provider raw compound case number와 ledger identity normalization 불일치**다.

## 원칙

alias/member는 **provider가 실제 반환한 verified raw case-number field에서만** 만든다.

금지:
- 모델 출력으로 alias 생성
- query text로 alias 생성
- expected gold로 alias 생성
- 특정 사건번호 hard-code

권장 evidence:

```js
{
  rawCaseNumber: "2014두12598, 12604",
  canonicalMembers: [
    "2014두12598",
    "2014두12604"
  ],
  acceptedEvidenceKeys: [
    "2014두12598,12604",
    "2014두12598",
    "2014두12604"
  ],
  detailVerified: true
}
```

최소 지원:

```text
2014두12598, 12604
2014두12598,12604
2011구합20239,26770
```

두 번째 숫자에 연도/사건종류가 생략되면 첫 member의 prefix를 상속한다.

불명확하면:

```text
COMPOUND_CASE_PARSE_AMBIGUOUS
```

로 두고 기존 strict reject 유지.

## Closed-world 유지

```text
provider raw compound evidence 존재
→ parser가 lossless member 생성
→ final eligible

provider evidence 없음
→ reject
```

closed-world를 완화하지 않는다.

## 테스트

필수:

```text
raw compound preserved
abbreviated second member expanded
compound full string accepted
verified component member accepted
invented sibling rejected
unrelated case rejected
ambiguous compound rejected
```

---

# 4. A Fix offline replay

현재 환경의 M8 private raw artifact가 있으면 **새 API/model 호출 없이** replay한다.

최소 대상:

```text
related-platform-union-worker
statute-trade-union-worker-2
```

확인:

```text
old related-platform-union-worker
CASE_NOT_OBSERVED → strict miss

new
provider-bound compound evidence → strict hit ?
```

M8 raw 기준 `9/17 → 10/17`은 이론값일 뿐이다. 실제 replay로 복구된 경우에만 기록한다.

채택 조건:

```text
strict-impact case recovered
AND
invented/unobserved sibling still rejected
AND
closed-world tests PASS
```

실패하면 fix revert 가능. Adapter prep은 별도로 계속한다.

---

# 5. 이번 환경에서는 신규 Blind-30 문항을 만들지 않는다

**매우 중요.**

현재 branch/commit에는 다음을 넣지 않는다.

```text
신규 blind 질문 text
신규 blind expected case
신규 blind review label
실제 blind run output
```

Blind 질문은 출근 후 **새 환경에서 처음 작성**한다.

목적:
- 현재 개발 trace와 분리
- 실제 holdout 유지
- repo/Codex context 노출 방지

private path:

```text
test/private/m9-blind30/
```

Git ignore 필수.

---

# 6. 새 환경의 Blind-30 schema

```json
{
  "version": "m9-blind30-v1",
  "questions": [
    {
      "id": "B30-01",
      "type": "single_axis",
      "query": "..."
    }
  ]
}
```

primary blind에는 `expectedCaseNumbers`를 넣지 않는다.

---

# 7. 신규 30문항 분포

권장:

| 유형 | 수 | 목적 |
|---|---:|---|
| single-axis ordinary legal issue | 6 | 기본 retrieval |
| sparse/colloquial/underspecified | 6 | semantic reframing |
| multi-axis fact pattern | 6 | sequential search |
| constitutional/admin | 4 | domain routing |
| statute + precedent interplay | 4 | law/case orchestration |
| hard/ambiguous/low-recall | 4 | robustness |

총 30.

제외:
- 사건번호 직접 조회
- 기존 golden/PH 문항의 단순 paraphrase
- M7R Known-10과 사실상 동일한 문제
- 답이 질문에 노출된 문제

기존 세트와 겹치지 않아야 한다:
- golden
- M6D private
- PH30
- M6F extension
- M7R/M8 known questions

질문 생성은 가능하면 **Luna-under-test가 직접 하지 않는다.**

---

# 8. Blind-30 runner 준비

이번 환경에서 runner만 만든다.

권장:

```text
test/m9-blind30-run.js
test/m9-blind30-build-packet.js
test/m9-blind30-unmask.js
test/m9-blind30-dryrun.test.js
```

실제 blind 질문이 없으므로 **dummy fixture로만 dry-run**.

---

# 9. 실행 계획 — 새 환경

```text
30 questions × 3 arms = 90 complete runs
```

각 question-arm semantic run은 정확히 1회.

semantic miss 재실행 금지.

transport/provider retry는 기존 정책에 따라 기록.

고정 rotation 예:

```text
B30-01  G-D → G-A6 → L-NATIVE
B30-02  G-A6 → L-NATIVE → G-D
B30-03  L-NATIVE → G-D → G-A6
```

fixed seed 기록.

---

# 10. Gemini quota 계산

D nominal:

```text
30 × 2 = 60 calls
```

A6 max:

```text
30 × 6 = 180 calls
```

Gemini nominal max:

```text
240 calls
```

retry 별도.

새 환경에서 실행 전 Gemini remaining quota/RPD를 확인하고 reserve 유지.

quota 부족으로 90-run을 반쪽 실행하지 않는다.

---

# 11. Luna scope

```text
30 questions
→ 30 independent persistent Codex sessions
```

질문마다 새:
- session
- EvidenceLedger
- gateway
- telemetry

질문 간 evidence/session 공유 금지.

---

# 12. Blind sample dedupe

review workload를 줄이기 위해:

```text
(question_id, normalized provider case identity)
```

기준 dedupe.

D/A6/Luna가 같은 사건을 반환하면 reviewer는 한 번만 평가한다.

arm membership은 `unmask.json`에만 저장.

random sample ID:

```text
S-001
S-002
...
```

---

# 13. Reviewer에게 숨길 것

```text
Gemini/Luna
D/A6/Native
adapter ID
rank
search query
tool count
tokens
cost
latency
동일 sample을 반환한 arm 정보
```

review packet에는:
- question_id
- query
- sample_id
- source locator/provider case evidence

만 둔다.

---

# 14. Blind rubric

기존 PH rubric 유지.

```text
DIRECT
STRONG_SUPPORT
WEAK_SUPPORT
IRRELEVANT
UNRESOLVED
```

가능하면 기존과 동일:
- issue_axes
- quote_support
- limitation_needed

새 scoring weight를 만들지 않는다.

기존 PH comparator가 있으면 그대로 재사용.

---

# 15. Review / unmask

private outputs:

```text
test/private/m9-blind30/
  questions.json
  manifest.json
  runs.jsonl
  run-summary.json
  review-packet.json
  review-labels.jsonl
  unmask.json
```

`unmask.json`은 reviewer에게 제공하지 않는다.

모든 sample label/schema validation 후에만 unmask한다.

---

# 16. Primary quality metrics

세 arm 모두:

```text
question-level wins
ties / best-tied
DIRECT-hit questions
STRONG_SUPPORT-hit questions
usable selected samples
broad usable samples
irrelevant rate
mean relative axis coverage
```

기존 PH 정의를 source of truth로 사용.

---

# 17. Safety / protocol metrics

공통:

```text
output valid
verified item rate
empty result rate
fallback rate
```

G-A6:
```text
legacy protocol pass
```

L-NATIVE:
```text
model_protocol_clean
selection_repaired
FORMAT_ONLY repair
GROUNDING repair
CASE_NOT_OBSERVED
forbidden contamination
```

---

# 18. 비용 / runtime

### G-D
- Gemini requests/q
- input/output tokens
- RPM waits
- MCP/q
- elapsed/q

### G-A6
- Gemini requests/q
- input/output tokens
- RPM waits
- MCP/q
- elapsed/q

### L-NATIVE
- input tokens/q
- cached input/q
- output tokens/q
- reasoning tokens/q
- Codex credits/q
- API-equivalent USD/q
- legal MCP/q
- elapsed/q

---

# 19. 최종 비교표

| Metric | Gemini D | Gemini A6 | Luna Native |
|---|---:|---:|---:|
| Wins | ? | ? | ? |
| Best/tied | ? | ? | ? |
| Direct-hit Q | ? | ? | ? |
| Strong-hit Q | ? | ? | ? |
| Usable | ? | ? | ? |
| Broad usable | ? | ? | ? |
| Irrelevant | ? | ? | ? |
| Axis coverage | ? | ? | ? |
| Output valid | ? | ? | ? |
| Avg model calls/session | ? | ? | ? |
| Avg MCP | ? | ? | ? |
| Avg latency | ? | ? | ? |
| Cost model | Gemini free-tier | Gemini free-tier | Codex usage |
| Credits/q | N/A | N/A | ? |

---

# 20. 이번 환경의 dry-run

실법률 API/model을 호출하지 않는다.

dummy 30 IDs로 검증:
- registry 3 adapter
- 30×3 = 90 planned slots
- rotation
- result-contract parse
- sample dedupe
- random blind IDs
- packet builder
- sealed unmask
- review label validation

---

# 21. Pre-push QA

필수:

```text
npm run check
npm run m8:test
npm run m9:test
git diff --check
```

가능하면 정상 제품 server가 이미 준비된 경우 `npm run verify`.

server 미기동이면 별도 live 실행을 만들지 말고 이유만 report.

commit 전:

```text
git status
git ls-files test/private
```

확인.

blind/private/secrets tracked이면 FAIL.

---

# 22. Prep report

tracked:

```text
docs/CASE_FINDER_M9_THREE_ARM_BLIND30_PREP.md
```

포함:
- base SHA
- A Fix 코드/테스트
- offline replay 결과
- adapter registry
- three adapter IDs
- dry-run 결과
- blind leakage audit
- changed files
- QA
- 새 환경 시작 절차

---

# 23. 현재 환경 checkpoint

준비 완료:

```text
M9_BLIND30_PREP_COMPLETE
M9_NEW_ENVIRONMENT_HANDOFF_READY
```

그 뒤 commit/push.

---

# 24. Commit / push

새 branch:

```bash
git switch -c m9-three-arm-blind30-prep
```

또는 이미 생성했다면 확인.

명시적 파일만 stage 권장:

```bash
git add <intended files>
git commit -m "[M9] Prepare pluggable adapters and blind-30 benchmark"
git push -u origin m9-three-arm-blind30-prep
```

가능하면 `git add .` 금지.

push 후 report:
- remote branch
- remote HEAD SHA
- working tree clean 여부

---

# 25. PUSH 후 강제 STOP

현재 환경에서 이후 금지:

```text
신규 30문항 작성
blind 90-run
Gemini 추가 benchmark
Luna 추가 benchmark
review/unmask
main merge
```

현재 PC quota/session 상태와 새 환경 benchmark를 섞지 않는다.

---

# 26. 새 환경 시작 체크리스트

```bash
git clone <repo>
cd case-finder
git fetch
git switch m9-three-arm-blind30-prep
git pull --ff-only
npm ci
```

검증:
- branch
- HEAD = handoff pushed SHA
- clean tree

환경 기록:
- OS
- Node
- korean-law-mcp
- Codex CLI
- `codex login status`
- Gemini model
- Luna model/medium

Secrets는 Git에 넣지 않는다:
- Gemini API key
- law.go credential
- Codex ChatGPT login

---

# 27. 새 환경 adapter preflight

blind 질문을 쓰기 전 smoke:

```text
registry resolves gemini_d
registry resolves gemini_a6
registry resolves luna_native

Gemini credential valid
Luna effective model = gpt-5.6-luna
reasoning = medium
restricted legal MCP inventory correct
forbidden Luna contamination = 0
```

smoke에는 blind 30을 사용하지 않는다.

---

# 28. Blind 질문 freeze

새 환경에서 처음:

```text
test/private/m9-blind30/questions.json
```

정확히 30개.

IDs:

```text
B30-01 ... B30-30
```

freeze manifest:

```text
version
count
normalized query hashes
type counts
created timestamp
```

질문 freeze 후 수정 금지.

첫 arm 실행 후 question replacement 금지.

---

# 29. Benchmark 시작 checkpoint

30문항 freeze + overlap review + runtime preflight 완료:

```text
M9_BLIND30_READY_TO_RUN
M9_USER_REVIEW_REQUIRED
```

그 이후 승인 시 90-run.

---

# 30. Run completeness

유효 benchmark:

```text
30 G-D
30 G-A6
30 L-NATIVE
= 90 complete records
```

미완료:

```text
M9_BLIND30_INCOMPLETE
```

quality denominator 산출 금지.

---

# 31. 최종 terminal 후보

```text
M9_LUNA_NATIVE_CLEAR_WIN
M9_GEMINI_A6_CLEAR_WIN
M9_D_COST_EFFICIENCY_WIN
M9_PRODUCT_TIERING_JUSTIFIED
M9_NO_CLEAR_WINNER
M9_PROTOCOL_INVALID
```

`M9_PRODUCT_TIERING_JUSTIFIED` 예:

```text
Gemini = 기본/무료
Luna = 고정밀 선택
```

처럼 사용자 선택형 제품 구성이 실제 데이터로 정당화된 경우.

---

# 32. 완료 정의 — 현재 환경

```text
[ ] base HEAD 확인
[ ] m9 branch

[ ] A compound evidence fix
[ ] provider-derived aliases only
[ ] closed-world 유지
[ ] invented sibling reject
[ ] offline replay

[ ] SearchAdapterRegistry
[ ] gemini_d
[ ] gemini_a6
[ ] luna_native
[ ] common result contract

[ ] Blind-30 input schema
[ ] three-arm runner
[ ] 90-slot rotation
[ ] telemetry
[ ] dedupe
[ ] packet builder
[ ] sealed unmask
[ ] dry-run only

[ ] no blind question content
[ ] no blind live run
[ ] private untracked

[ ] QA
[ ] prep report
[ ] commit
[ ] push
[ ] remote HEAD 기록
[ ] clean tree
[ ] STOP
```

---

# 33. 최종 원칙

M9는 세 모델/모드를 같은 agent protocol로 억지로 통일하지 않는다.

```text
G-D
= Gemini + deterministic D

G-A6
= Gemini + 기존 A6

L-NATIVE
= GPT-5.6 Luna-medium + persistent native Codex + restricted legal MCP
```

공통화하는 것은:

```text
result contract
source evidence
verification
telemetry
blind evaluation
```

뿐이다.

**현재 환경에서는 A Fix와 어댑터/블라인드 인프라까지만 만들고 push한다.**

**신규 30문항은 출근 후 새 환경에서 처음 생성·freeze하고, 그 다음 90-run blind benchmark를 수행한다.**
---
---

# 34. M9 completion record (2026-08-13)

Status: M9_BLIND30_PREP_COMPLETE / M9_NEW_ENVIRONMENT_HANDOFF_READY

- Branch: m9-three-arm-blind30-prep
- Base SHA: 2b56d19c6d85f11dd1edc3a27e631db82b5d0770
- Scope: current-environment preparation only. No new blind questions, live 90-run benchmark, blind review, unmask, or main merge was performed.

## Completed implementation

- A Fix: EvidenceLedger now preserves provider raw compound case numbers and creates aliases only from verified provider detail. Abbreviated members are expanded from the provider-derived prefix; ambiguous or invented members remain rejected by the closed-world gate.
- Covered cases: raw compound preserved, abbreviated second member expanded, full compound accepted, verified component accepted, invented sibling rejected, unrelated/ambiguous detail rejected.
- Search adapter registry IDs: gemini_d, gemini_a6, luna_native. All three use m9-result-contract-v1, including output_valid, model_protocol_clean, and selection_repaired fields.
- Blind protocol: exactly 30 input records, deterministic 3-arm rotation, 90 slots, provider-case dedupe, arm-sealed packet/unmask, and review-label validation.

## Offline compound replay

Source: ignored M8 Luna Golden-17 trace and final artifacts under test/private/m8-golden17-live-final-luna/luna/; no API or model call was made.

- related-platform-union-worker: old final selected=[]; recorded search found 2014두12598; recorded detail returned provider raw 2014두12598, 12604; replayed gate selected 2014두12598 (recovered=true).
- statute-trade-union-worker-2: old final selected 2014두12598; replay retained that target (recovered=true).
- Synthetic negative check: 2014두99999 was rejected as CASE_NOT_OBSERVED.
- Result: 2/2 target replay recoveries. This is an offline evidence-replay result, not a new live accuracy claim.

## Dry-run and leakage audit

- Dry-run result: 30 questions / 90 slots / 30 slots per arm / 90 valid result contracts.
- Packet result: 30 deduplicated samples, 30 sealed unmask entries, three arm identities per sealed entry.
- No real blind question text, expected case number, review label, or actual M9 live output was added. The tracked fixture is dummy-only and test/private/ remains ignored.

## QA

- npm run check passed.
- npm run m8:test passed: 16 tests.
- npm run m9:test passed: 14 tests.
- npm run m9:replay passed: 2/2 offline targets recovered.
- git diff --check passed.
- Live server verification was not run because the current environment was not prepared for a live benchmark; no server was launched.

## New-environment start point

In a fresh environment, create and freeze the real 30-question blind input under ignored test/private/m9-blind30/, then run the three adapters for 90 total slots, build the blind packet, conduct blind review, and unmask only after review validation. The current branch is intentionally stopped before those steps.

## Changed files

package.json; src/aoV2/evidenceLedger.js; src/searchAdapters/{resultContract,geminiDAdapter,geminiA6Adapter,lunaNativeAdapter,registry,index}.js; src/blind30/protocol.js; test/evidenceLedger.test.js; test/finalSelectionGate.test.js; test/searchAdapters.test.js; test/m9-blind30-{run,build-packet,unmask,dryrun.test}.js; test/m9-compound-replay.js; test/m9-compoundReplay.test.js; test/fixtures/m9-blind30-dummy.json.
