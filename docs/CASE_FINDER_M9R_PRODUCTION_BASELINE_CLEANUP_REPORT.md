# M9-R Production Baseline Cleanup Report

## Scope

M9 Blind-30에서 확정된 검색 구성을 제품용 HEAD에 남기고, 연구용 runner·legacy adapter·중간 연구 문서를 제거했다. M10 UI와 installer 구현, optional dependency slimming, 새 검색 benchmark는 이 작업 범위에 포함하지 않았다.

## Git baseline

```text
M9_FINAL_SHA = 946ccb1f4ce8edec95d8696b8460c7b9a70a495c
cleanup branch = m9r-production-baseline-cleanup
M9R_CLEANUP_SHA = 973bdd463a27adfc7a7b68a9043c05db71ae1b5d
main before promotion = 7671a3d9aab9a358cf60f4746b8e957b8ee9eac4
main after promotion = 973bdd463a27adfc7a7b68a9043c05db71ae1b5d
```

M9 final commit과 M9R cleanup branch를 원격에 push했다. archive tag 7개를 원격에 게시하고 SHA를 검증한 뒤, M9R baseline을 `main`에 fast-forward로 승격했다. archive tag로 보존된 연구 branch 7개도 삭제했으며, `main`과 `m9r-production-baseline-cleanup`은 유지한다.

## Product runtime retained

```text
src/searchAdapters/geminiDAdapter.js
src/searchAdapters/lunaNativeAdapter.js
src/searchAdapters/registry.js
src/aoV2/evidenceLedger.js
src/aoV2/finalSelectionGate.js
src/aoV2/legalToolGateway.js
src/aoV2/safety.js
src/aoV2/telemetry.js
src/aoV2/providers/codexNativeAo.js
src/aoV2/restrictedMcp/stdioServer.js
src/codexNativeSession.js
```

제품 registry에는 `gemini_d`와 `luna_native`만 남겼다. `SEARCH_ADAPTER`를 startup에서 검증하고, server는 registry를 통해 자연어 검색을 실행한다. `gemini_d`는 `MODEL_RUNTIME`과 무관하게 Gemini runtime을 사용하며, Luna는 Codex Native AO-v2로 고정된다.

## Removed from product HEAD

- Gemini A6 adapter, Gemini Native AO-v2 provider, legacy agentic/model-runtime/codex-cli switch
- M6–M9 blind/benchmark/replay runner와 `src/blind30`
- M6–M8 final report, handoff, diagnosis, private-review 문서
- M9 packet/review runner 문서와 private fixture

과거 연구 결과는 archive tag/history에 보존한다. M9 최종 수치와 선택 근거는 [CASE_FINDER_FINAL_REPORT_M9_BLIND30.md](./CASE_FINDER_FINAL_REPORT_M9_BLIND30.md), 요약 결정은 [RESEARCH_DECISIONS.md](./RESEARCH_DECISIONS.md)에 남겼다.

## Archive tags

annotated tag 7개를 생성하고 원격에 push했다. 각 tag의 dereferenced commit SHA가 아래 기준점과 일치하는지 원격에서 검증했다.

```text
archive/agentic-diagnose  -> e427ef1db940a90f54c8e193fa2c7cf6396a70ce
archive/m6d-private-blind -> c83820de93406f99d62288caa2e376e1b43bf4de
archive/m6e-d-a6-gate     -> 4f28d2f1a61c95ede457f19f118fb76eb3b7ce80
archive/m6f-ao-extension  -> 52790fcb91810f76f1db8d949093e85528f7d140
archive/m7-luna-benchmark -> 69db8ca634bfaa0daaf79b916736c99558d8817c
archive/m8-native-ao-v2   -> 2b56d19c6d85f11dd1edc3a27e631db82b5d0770
archive/m9-search-final   -> 946ccb1f4ce8edec95d8696b8460c7b9a70a495c
```

## Packaging boundary

`packaging/runtime-manifest.json`에 `CaseFinderSetup.exe`를 installer entrypoint로 하는 runtime allowlist를 기록했다. `.git`, docs, tests, private blind artifacts, logs, state, credentials, build output은 installer payload에서 제외한다.

## Remote branch state

```text
kept:   main
kept:   m9r-production-baseline-cleanup
deleted: Agentic_diagnose
deleted: m6d-private-holdout-blind-eval
deleted: m6e-d-a6-conditional-rescue
deleted: m6f-d-ao-extension
deleted: m7-codex-luna-medium-eval
deleted: m8-provider-native-ao-v2
deleted: m9-three-arm-blind30-prep
```

## QA

```text
npm run check       PASS
npm run product:test 23/23 PASS
git diff --check    PASS
```

`npm run verify`의 기존 server integration runner는 M9 final 단계에서 `127.0.0.1:3300` 서버가 기동되지 않아 `fetch failed`를 반환했다. cleanup에서 `verify`는 server 미기동에 의존하지 않는 `check + product:test`로 재정의했다. 실제 API·Codex 통합 smoke test는 인증된 packaging/M10 환경에서 별도로 수행한다.

## Terminal status

```text
M9R_PRODUCT_BASELINE_CLEAN
```

원격 보존, main 승격, archive tag 검증, 연구 branch 삭제, product QA까지 완료했다. 다음 작업은 handoff에 따라 `main`을 기준으로 M10 productization을 시작하는 것이다.
