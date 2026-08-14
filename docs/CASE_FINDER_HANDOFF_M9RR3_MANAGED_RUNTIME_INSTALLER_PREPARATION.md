# CASE_FINDER_HANDOFF_M9RR3_MANAGED_RUNTIME_INSTALLER_PREPARATION

## 1. 목적

`m9rr2-final-review-fixes` 브랜치의 M9RR2 수정사항을 유지하면서, Case Finder의 Luna Native 실행 환경을 **사용자 PC의 임의 설치 상태를 광범위하게 탐색하는 구조**에서 **Case Finder가 관리하는 설치형 런타임 구조**로 전환한다.

최종 배포 목표는 다음과 같다.

```text
사용자에게 전달되는 파일
└─ CaseFinderSetup.exe

설치 후
%LOCALAPPDATA%\Fable\CaseFinder\
├─ app\
│  ├─ src\
│  ├─ public\
│  ├─ prompts\
│  ├─ node_modules\
│  └─ ...
├─ runtime\
│  ├─ node\
│  │  └─ node.exe
│  └─ codex\
│     └─ bin\
│        ├─ codex.exe
│        └─ codex-code-mode-host.exe
├─ state\
│  └─ codex-home\
└─ logs\
```

설치 프로그램 내부에는 여러 런타임과 프로세스가 포함될 수 있다.
**설치 후까지 단일 프로세스 EXE로 만드는 것은 목표가 아니다.**

---

## 2. 기준 브랜치

- Repository: `youngseok0y/case-finder`
- Working branch: `m9rr2-final-review-fixes`
- 현재 HEAD: `4909e07871bf7d6d898255bf3d88d325f4a40c0c`
- 현재 HEAD commit:
  - `[M9RR2] Auto-discover validated Luna CLI`
- Base:
  - `main`
  - `c0fab1b686f4858d1ece59fcb835644b4fb673be`

현재 브랜치는 `main` 대비 5 commits ahead / 0 behind 상태다.

M9RR2에서 수정한 query 보존, terminal state, restricted MCP 환경 격리, provenance, 안전 거부 문구, launcher 안전성 등은 **회귀시키지 않는다.**

---

## 3. 이번 단계의 핵심 판단

현재 `src/codexResolver.js`는 다음을 탐색한다.

- `CODEX_CLI_PATH`
- `PATH`
- `%USERPROFILE%\.codex\plugins`
- `%USERPROFILE%\.codex\.sandbox-bin`
- `%APPDATA%\npm`
- `%LOCALAPPDATA%`
- `%ProgramFiles%`

이 구조는 개발 환경 복구용으로는 의미가 있지만, 최종 배포용으로는 설치 상태의 경우의 수가 지나치게 많다.

M9RR3에서는 resolver의 책임을 축소한다.

### 새 우선순위

```text
1. Case Finder managed Codex
2. CODEX_CLI_PATH developer override
3. PATH에 존재하는 codex.exe
4. CODEX_CLI_UNAVAILABLE
```

광범위한 사용자 디렉터리 탐색은 제거한다.

---

# 4. 절대 조건

## 4.1 Luna 실패 시 Gemini 자동 전환 금지

기존 정책을 유지한다.

```text
SEARCH_ADAPTER=luna_native
```

상태에서 Codex 실행 환경이 없거나 실패하면:

- Gemini로 fallback하지 않는다.
- HTTP 503을 반환한다.
- 명확한 Luna runtime 오류를 표시한다.

---

## 4.2 M9RR2 정확성·안전 수정 유지

다음 수정은 회귀 금지다.

- Luna adapter 입력 query 보존
- 상세 검증 전부 실패 시 `SEARCH_FAILED`
- `outputValid=false` 안전 terminal 분리
- restricted MCP environment isolation
- 탐색-only 법령의 product 결과 유출 방지
- provider 배열 defensive copy
- 법령 링크 helper 단일화
- 안전 거부 문구 공통화
- direct response `service=case-finder`
- foreign/stale port process 안전 처리
- Codex child process에 Case Finder secret 미전달

---

## 4.3 사용자에게 경로 입력을 요구하지 않는다

최종 사용자에게 다음 설정을 요구하지 않는다.

```text
CODEX_CLI_PATH
Node 경로
npm 경로
Codex 설치 경로
MCP 실행 경로
Python 경로
```

`CODEX_CLI_PATH`는 필요하면 **개발자 override**로만 남긴다.

---

## 4.4 런타임을 단일 Node executable로 번들링하지 않는다

현재 Luna restricted MCP 실행은 `process.execPath`를 Node executable로 사용한다.

따라서 `pkg`, `nexe` 등으로 애플리케이션 자체를 단일 executable로 만들어 `process.execPath = CaseFinder.exe`가 되는 구조는 이번 단계에서 도입하지 않는다.

private Node runtime을 유지한다.

---

# 5. P0 — 반드시 수정

## P0-1. `codexResolver.js` 단순화

### 현재 문제

현재 resolver는 사용자 시스템 전체에서 가능한 Codex 설치 흔적을 광범위하게 찾는다.

이 방식은:

- 설치 상태별 분기 증가
- npm 설치와 standalone 설치 혼재
- Desktop/AppX 상태와 CLI 상태 혼동
- maintenance 비용 증가
- 제3자 PC 재현성 저하

문제를 만든다.

### 변경 목표

resolver를 다음 구조로 변경한다.

```js
resolveCodexCommand()
  -> resolveManagedCodex()
  -> resolveConfiguredOverride()
  -> resolvePathCodex()
  -> throw CODEX_CLI_UNAVAILABLE
```

### managed 경로

실제 경로 이름은 packaging helper에서 단일 source로 관리한다.

권장 논리 경로:

```text
<CASE_FINDER_INSTALL_ROOT>\runtime\codex\bin\codex.exe
<CASE_FINDER_INSTALL_ROOT>\runtime\codex\bin\codex-code-mode-host.exe
```

### 후보 검증

모든 후보는 최소한 아래를 통과해야 한다.

```text
1. codex.exe 존재
2. codex-code-mode-host.exe 존재
3. codex.exe --version 성공
```

실패한 후보는 사용하지 않는다.

### 삭제 대상

다음 자동 탐색은 제거한다.

```text
%USERPROFILE%\.codex\plugins
%USERPROFILE%\.codex\.sandbox-bin
%APPDATA%\npm\node_modules\@openai\codex
%LOCALAPPDATA% 재귀성 후보
%ProgramFiles% 임의 후보
```

PATH 탐색은 유지할 수 있다.

---

## P0-2. 공식 standalone 설치와 호환되는 경로 처리

기존 resolver는 공식 standalone 설치 형태를 직접 지원한다고 가정하지 않는다.

특히 standalone visible install 구조에서 `bin` 디렉터리를 누락하는 형태가 없어야 한다.

다만 제품 구조에서는 공식 설치 위치를 무한 탐색하기보다, installer가 **Case Finder managed install directory**로 Codex를 배치하는 방식을 우선한다.

---

## P0-3. Managed Codex runtime 상수 분리

Codex 및 runtime 경로를 여러 파일에서 직접 조합하지 않는다.

예:

```text
src/runtimePaths.js
```

또는 동등한 helper를 만들고 다음을 단일 source로 관리한다.

```text
installRoot
managedNodePath
managedCodexDir
managedCodexPath
managedCodexHostPath
codexHomePath
logsPath
statePath
```

개발 환경에서는 현재 repository root를 fallback으로 사용할 수 있다.

---

## P0-4. 현재 HEAD 기준 검증 재실행

현재 M9RR2 final review report는 `7707b392...`를 implementation SHA로 기록하고 있지만 현재 브랜치 HEAD는 `4909e078...`이다.

따라서 기존 `38/38 PASS`를 현재 HEAD의 최종 검증 결과로 간주하지 않는다.

M9RR3 수정 완료 후 반드시:

```text
npm run check
npm run product:test
npm run verify
git diff --check
```

를 다시 실행한다.

최종 보고서에는 **실제 검증한 HEAD SHA**를 기록한다.

---

# 6. P1 — 설치형 제품 전환

## P1-1. 시스템 Node 의존 제거

현재 `start.bat`는:

```text
node --version
npm ci
node src/server.js
```

를 실행한다.

최종 배포판에서는 사용자 시스템의 Node/npm에 의존하지 않는다.

설치 프로그램이 private Node runtime을 제공해야 한다.

권장 실행:

```text
<install-root>\runtime\node\node.exe
<install-root>\app\src\server.js
```

개발용 `npm start`는 유지 가능하다.

---

## P1-2. 실행 시 `npm ci` 제거

최종 배포 실행 시 dependency installation을 수행하지 않는다.

다음은 installer/build 단계에서 완료되어 있어야 한다.

```text
production node_modules
korean-law-mcp
@modelcontextprotocol/sdk
dotenv
@google/genai
```

사용자 실행 단계에서는 dependency 설치를 시도하지 않는다.

---

## P1-3. `runtime-manifest.json` 갱신

현재 manifest의 다음 개념을 폐기한다.

```text
Codex CLI/App Server is provisioned separately
```

새 packaging contract는 다음을 명시한다.

```text
CaseFinderSetup.exe
  - private Node runtime
  - Case Finder application payload
  - production node_modules
  - korean-law-mcp
  - managed Codex standalone
```

추가로 manifest에 가능한 경우 아래 필드를 둔다.

```json
{
  "runtime": {
    "node": {
      "managed": true,
      "version": "..."
    },
    "codex": {
      "managed": true,
      "release": "...",
      "required_files": [
        "codex.exe",
        "codex-code-mode-host.exe"
      ]
    }
  }
}
```

Codex release는 **실제 검증한 버전으로 고정**한다.

`latest` 추종은 금지한다.

---

## P1-4. 전용 `CODEX_HOME`

Case Finder용 Codex runtime은 사용자 개인 Codex 설정과 최대한 분리한다.

권장:

```text
<install-root>\state\codex-home
```

Codex child process 실행 시:

```text
CODEX_HOME=<install-root>\state\codex-home
```

을 명시한다.

단, 로그인 토큰과 인증정보의 저장 방식은 Codex 공식 동작과 충돌하지 않도록 실제 standalone 검증 후 결정한다.

---

## P1-5. `/health` 확장

현재 `/health`는 server/MCP liveness 확인 용도다.

M9RR3에서는 Luna readiness를 별도 상태로 노출한다.

권장 응답:

```json
{
  "service": "case-finder",
  "ok": true,
  "mcp": {
    "connected": true
  },
  "luna": {
    "configured": true,
    "codexAvailable": true,
    "codeModeHostAvailable": true,
    "version": "..."
  }
}
```

### 주의

`/health` 호출마다 실제 LLM 질의를 실행하지 않는다.

`codex --version` 또는 사전 계산한 runtime 상태 정도만 사용한다.

---

## P1-6. installer post-install verification 정의

설치 완료 후 다음 순서로 검증한다.

```text
A. managed node.exe 존재
B. codex.exe 존재
C. codex-code-mode-host.exe 존재
D. codex.exe --version 성공
E. Case Finder server 기동
F. /health 200
G. restricted MCP startup 성공
H. Luna golden /ask 1건 성공
```

H 단계는 사용자 로그인 상태가 필요한 경우:

```text
LUNA_AUTH_REQUIRED
```

와 런타임 설치 실패를 구분해야 한다.

---

# 7. P1 — 오류 분류 개선

현재 Luna runtime unavailable은 아래 오류를 묶어 처리한다.

```text
CODEX_CLI_UNAVAILABLE
ENOENT
EACCES
EPERM
```

설치형 제품에서는 가능한 경우 다음처럼 분류한다.

```text
CODEX_CLI_UNAVAILABLE
CODEX_HOST_UNAVAILABLE
CODEX_VERSION_CHECK_FAILED
CODEX_AUTH_REQUIRED
CODEX_SPAWN_FAILED
CODEX_NATIVE_SESSION_TIMEOUT
```

제품 UI에 모든 내부 오류 코드를 노출할 필요는 없다.

사용자 메시지는 최소한 아래 수준으로 구분한다.

### 설치 없음

```text
Luna Native 실행 파일을 찾지 못했습니다.
Case Finder 설치 복구를 실행해 주세요.
```

### 로그인 필요

```text
Luna Native 로그인이 필요합니다.
Codex 로그인을 완료한 뒤 다시 시도해 주세요.
```

### 실행 오류

```text
Luna Native 실행 환경을 시작하지 못했습니다.
설치 복구 후 다시 시도해 주세요.
```

Gemini fallback은 하지 않는다.

---

# 8. P2 — 사용자 설정 단순화

## `.env.example`

현재 사용자 노출 설정 중 다음은 제거 또는 개발자 전용으로 이동한다.

```text
CODEX_CLI_PATH
CODEX_TIMEOUT_MS
GCP_PROJECT_ID
```

제품 사용자 기준 기본 예:

```env
LAW_OC=
SEARCH_ADAPTER=luna_native
```

Gemini mode를 제품에서 계속 제공한다면:

```env
GEMINI_API_KEY=
```

를 조건부로 유지한다.

`PORT`, `SEARCH_DISPLAY` 등은 advanced 설정으로 별도 분리 가능하다.

---

# 9. P2 — README 설치 절차 수정

현재 README의:

```text
Node.js 설치
npm ci
start.bat 실행
```

절차는 최종 배포 문서로 유지하지 않는다.

최종 사용자용 README는 다음 흐름으로 바꾼다.

```text
1. CaseFinderSetup.exe 실행
2. 필요한 인증정보 입력
3. Luna 사용 시 Codex 로그인
4. Case Finder 실행
```

개발 환경 설치법은 별도 `Development` 섹션으로 이동한다.

---

# 10. 테스트 요구사항

기존 테스트를 유지하고 아래 회귀 테스트를 추가한다.

## Resolver

### managed runtime 우선

```text
managed Codex valid
PATH Codex valid
=> managed Codex 선택
```

### override

```text
managed 없음
CODEX_CLI_PATH valid
=> override 선택
```

### PATH fallback

```text
managed 없음
override 없음
PATH Codex valid
=> PATH 선택
```

### host 누락

```text
codex.exe 존재
host 없음
=> reject
```

### version 실패

```text
codex.exe 존재
host 존재
--version 실패
=> reject
```

### 모든 후보 실패

```text
=> CODEX_CLI_UNAVAILABLE
```

---

## Runtime path

managed runtime path가 repository 위치, 현재 working directory, 사용자 profile에 우연히 의존하지 않는지 테스트한다.

---

## Security

기존 아래 테스트는 유지한다.

```text
Codex child env에 LAW_OC 없음
Codex child env에 GEMINI_API_KEY 없음
Codex child env에 GOOGLE_APPLICATION_CREDENTIALS 없음
restricted MCP upstream에는 LAW_OC만 전달
```

---

## Product

다음이 유지되어야 한다.

```text
direct search PASS
Gemini D PASS
Luna query preservation PASS
SEARCH_FAILED terminal PASS
safety rejection PASS
result provenance PASS
foreign port protection PASS
```

---

# 11. 실제 실행 검증

자동 테스트 성공만으로 M9RR3를 PASS 처리하지 않는다.

최종 환경에서 최소한 아래를 실행한다.

## 11.1 Direct

사건번호 direct query 1건.

기대:

```text
HTTP 200
service=case-finder
stage=DIRECT
verified item >= 1
```

---

## 11.2 Gemini D

Gemini 제품 모드를 유지하는 경우 자연어 1건.

기대:

```text
HTTP 200
stage=GEMINI_D
query preservation
validated output
```

---

## 11.3 Luna Native

managed Codex runtime에서 자연어 golden query 최소 1건.

권장:

```text
임차보증금을 돌려받지 못했을 때
```

기대:

```text
HTTP 200
stage=LUNA_NATIVE
restricted MCP 사용
verified result
Gemini fallback 없음
```

실패 시 내부 error code와 실제 stderr를 기록하되 secret은 제거한다.

---

# 12. 설치 프로그램 구현 범위

M9RR3에서 반드시 완성된 GUI installer EXE까지 만들 필요는 없다.

이번 단계의 최소 완료 조건은:

```text
1. runtime layout 확정
2. managed Codex resolver 구현
3. private Node 실행 경로 확정
4. installer contract/manifest 확정
5. post-install verification script 또는 equivalent 구현
6. 테스트 PASS
7. 실제 Luna managed runtime smoke PASS
```

이후 installer builder 자체는 다음 단계로 분리 가능하다.

예:

```text
M9RR4 — Windows Installer Build & Clean-PC Validation
```

---

# 13. 범위 밖

이번 단계에서 다음은 하지 않는다.

- 검색 알고리즘 변경
- Luna prompt 최적화
- AO-v2 reasoning 구조 변경
- candidate scoring 변경
- Gemini 정확도 실험
- 법제처 transport/curl/TLS 문제 재조사
- 새로운 Gold set 구축
- frontend 전면 재설계
- Codex Desktop/AppX 내부 파일 강제 탐색
- 사용자 시스템 전역 Node/npm 수정
- installer 실행 중 임의 시스템 프로세스 종료
- Luna 실패 시 Gemini 자동 fallback

---

# 14. Stop-loss

이번 단계가 실패했을 때 하위 탐색 실험을 계속 추가하지 않는다.

### 성공 기준

아래를 모두 만족하면 PASS다.

```text
A. managed Codex path가 결정적으로 해석됨
B. code-mode host 사전검증 성공
C. private Node로 server/MCP 실행 가능
D. 기존 M9RR2 테스트 회귀 없음
E. 실제 Luna golden smoke 성공
F. Gemini silent fallback 없음
```

### 실패 기준

다음 중 하나라도 구조적으로 해결되지 않으면 M9RR3를 중단하고 원인을 문서화한다.

```text
1. 공식 standalone Codex를 별도 managed directory에서 안정적으로 실행할 수 없음
2. code-mode host 경로 또는 패키징 계약을 안정적으로 고정할 수 없음
3. private Node runtime에서 restricted MCP chain이 정상 실행되지 않음
4. Codex 인증 상태를 사용자 전역 설정과 분리했을 때 정상 로그인/실행이 불가능함
```

이 경우 resolver 탐색 범위를 다시 무한정 확대하지 않는다.

---

# 15. 완료 산출물

M9RR3 완료 시 다음을 제공한다.

```text
src/codexResolver.js
src/runtimePaths.js 또는 동등 helper
src/server.js
src/productMessages.js
start.bat 또는 새 launcher
packaging/runtime-manifest.json
.env.example
README.md
관련 테스트
```

그리고 다음 보고서를 작성한다.

```text
docs/CASE_FINDER_M9RR3_MANAGED_RUNTIME_REPORT.md
```

보고서에는 최소한 아래를 포함한다.

```text
- Base SHA
- Final implementation SHA
- 변경 파일
- managed runtime layout
- Codex version
- Node version
- npm run check 결과
- npm run product:test 결과
- npm run verify 결과
- git diff --check 결과
- direct smoke
- Gemini smoke
- Luna managed runtime smoke
- 실패/보류 항목
- 최종 terminal
```

---

# 16. 최종 terminal

허용되는 최종 상태는 다음 중 하나다.

```text
M9RR3_MANAGED_RUNTIME_PASS
M9RR3_MANAGED_RUNTIME_BLOCKED
```

`PENDING`으로 종료하지 않는다.

### PASS

managed runtime 구조와 실제 Luna smoke까지 완료.

### BLOCKED

구조적 blocker가 존재하며, blocker 원인과 재현 절차를 문서화.

---

# 17. 구현 순서 권장

```text
1. m9rr2-final-review-fixes에서 작업 시작
2. runtimePaths helper 도입
3. codexResolver 축소
4. resolver 회귀 테스트
5. private Node runtime contract 반영
6. runtime-manifest 갱신
7. health/readiness 개선
8. env/README 정리
9. npm run verify
10. managed Codex 실제 smoke
11. final report 작성
12. PASS일 때만 main merge 후보로 승격
```

M9RR3 완료 전에는 `m9rr2-final-review-fixes`를 `main`에 merge하지 않는다.
