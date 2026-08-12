# M6D Private Holdout — External Blind Review Instructions

## 목적

이 packet은 동일한 법률 질문에 대해 검색된 판례가 질문의 쟁점을 얼마나 직접적이고 유용하게 다루는지 외부 reviewer가 독립적으로 평가하기 위한 것입니다. 이 평가는 D/A6/AO arm 비교를 위한 것이며, reviewer에게는 arm 정보가 제공되지 않습니다.

## 입력

`test/private/m6d-holdout/blind_packet.json`의 각 sample에는 다음 정보만 있습니다.

- `sample_id`: 평가 결과를 연결하기 위한 식별자
- `question_id`: 질문 식별자
- `question_text`: 원 질문
- `provider_id`: 법령센터 판례 식별자
- `source_locator`: 법령센터 원문 링크

`provider_id`, 실행 arm, 실행 순서, Gemini 요청 수, MCP 호출 수, fallback 여부, 순위, 기존 정답 목록은 평가 시 사용하지 않습니다. 동일한 질문의 sample들이 어떤 arm에서 왔는지도 공개되지 않습니다.

## 평가 절차

각 sample에 대해:

1. `question_text`를 읽고 질문의 법적 쟁점과 예상되는 구제·제한 쟁점을 파악합니다.
2. `source_locator`의 법령센터 원문을 독립적으로 확인합니다.
3. 판례가 질문의 핵심 쟁점을 직접 판단하는지, 강하게 뒷받침하는지, 약하게만 관련되는지, 무관한지 평가합니다.
4. 판례 원문에서 질문과 연결되는 근거가 실제로 확인되는지 평가합니다.
5. 질문에 답하기 위해 필요한 쟁점 축이 판례에 다뤄졌는지 `issue_axes`에 기록합니다.
6. 사실관계·법적 한계·추가 확인 필요성이 있으면 `limitation_needed`에 기록합니다.

검색 결과의 순위나 사건번호의 유명세가 아니라, 해당 질문에 대한 원문 근거와 쟁점 적합성을 평가합니다. 법률 자문이나 최종 결론을 작성할 필요는 없습니다.

## 허용 enum

`relevance`는 다음 중 하나만 사용합니다.

```text
DIRECT
STRONG_SUPPORT
WEAK_SUPPORT
IRRELEVANT
UNRESOLVED
```

`quote_support`와 `limitation_needed`는 각각 다음 중 하나입니다.

```text
YES
NO
UNRESOLVED
```

`issue_axes`는 원문에서 확인되는 질문 관련 쟁점을 짧은 문자열 배열로 작성합니다. 판단이 어려우면 `UNRESOLVED`를 사용하고 억지로 분류하지 않습니다.

## 결과 형식

sample마다 정확히 한 줄의 JSON을 작성합니다.

```json
{
  "sample_id": "MH01-S001",
  "question_id": "MH01",
  "provider_id": "123456",
  "relevance": "DIRECT",
  "issue_axes": ["성과급 지급 조건", "퇴직 후 청구 가능성"],
  "quote_support": "YES",
  "limitation_needed": "YES"
}
```

결과 파일 권장 경로:

```text
test/private/m6d-holdout/blind_review_scores.jsonl
```

`sample_id`는 packet에 있는 값을 그대로 사용하고, 누락·중복·임의 sample 추가를 하지 않습니다. 외부 reviewer는 arm을 추측하거나 Codex 대신 제품 결정을 내리지 않습니다. 결과 JSONL을 반환하면 이후 schema 검증과 unmask는 별도 절차로 수행합니다.
