# Research Decisions

이 문서는 제품 HEAD에 남겨야 하는 검색 구성 결정만 요약한다. 세부 실험 로그와 중간 handoff는 archive tag/history에서 보존한다.

## 결정 흐름

- M5–M6: 결정론 D를 baseline으로 확립하고, A6/AO 비교를 정확성 계약과 validator 전제 아래 수행했다.
- M6: D→A6 자동 rescue는 제품 경로로 채택하지 않았다.
- M7: Codex/Luna benchmark에서 Gemini-shaped AO의 한계를 확인했다.
- M8: provider-native Luna AO-v2와 restricted legal MCP, EvidenceLedger, FinalSelectionGate를 확립했다.
- M9: Blind-30에서 Gemini D, Gemini A6, Luna Native를 30문항씩 비교했다.

## M9 최종 선택

| 제품 adapter | 구성 | M9 question wins |
|---|---|---:|
| `gemini_d` | Gemini / Deterministic D | 6 |
| `luna_native` | GPT-5.6 Luna medium / Native AO-v2 / restricted legal MCP | 14 |

Gemini A6는 5승이었지만 제품 dropdown에는 노출하지 않는 legacy 연구 경로로 종료했다. Gemini AO-v2도 제품 후보에서 종료했다.

## 안전장치

Luna의 승격 대상은 모델 단독이 아니다.

```text
persistent native session
→ restricted legal MCP
→ per-question EvidenceLedger
→ FinalSelectionGate
→ verified-only result contract / renderer
```

검색 관측, 상세 조회 성공, 상세 identity 검증을 모두 통과한 evidence만 표시한다. compound 사건번호의 verified member/alias는 provider raw evidence에서 확인된 경우에만 허용한다. forbidden tool contamination은 0이어야 하며, private reasoning·system prompt·raw tool planning·인증 토큰은 UI와 로그에 노출하지 않는다.

## Archive

M9-R에서 다음 연구 branch HEAD를 annotated tag로 보존한 뒤 원격 branch를 정리한다.

```text
archive/agentic-diagnose
archive/m6d-private-blind
archive/m6e-d-a6-gate
archive/m6f-ao-extension
archive/m7-luna-benchmark
archive/m8-native-ao-v2
archive/m9-search-final
```

현재 canonical specification은 `case-finder-spec.md`이며, M9 수치와 최종 보고서는 `CASE_FINDER_FINAL_REPORT_M9_BLIND30.md`에 있다.
