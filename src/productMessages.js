export const PRODUCT_SERVICE = "case-finder";

export const LUNA_SDK_RUNTIME_MESSAGE = "Luna SDK 실행 구성요소를 시작하지 못했습니다. Case Finder를 다시 실행하고 Codex/ChatGPT 로그인 상태와 설치된 SDK 구성요소를 확인한 뒤 다시 시도하세요.";
export const LUNA_AUTH_REQUIRED_MESSAGE = "Luna Native 로그인이 필요합니다. Codex/Luna 로그인을 완료한 뒤 다시 시도해 주세요.";
export const LUNA_RUNTIME_ERROR_MESSAGE = "Luna Native 실행 중 오류가 발생했습니다. 설치 상태와 로그를 확인해 주세요.";
export const LUNA_RUNTIME_UNAVAILABLE_MESSAGE = LUNA_SDK_RUNTIME_MESSAGE;

export const SAFETY_REJECTED_MESSAGE = "검색 결과를 안전하게 검증하지 못해 결과를 표시하지 않았습니다. 다시 검색해 주세요.";

export const SEARCH_FAILED_MESSAGE = "판례 후보를 확인했지만 상세 원문 검증에 실패해 결과를 표시하지 않았습니다. 다시 검색하거나 잠시 후 다시 시도해 주세요.";

export const NO_RESULT_MESSAGE = "검색을 완료했지만 표시할 수 있는 검증된 결과가 없습니다.";
export const DIRECT_LOOKUP_MISS_PRIMARY = "해당 사건번호의 판결을 국가법령정보센터에서 찾지 못했습니다. 사건번호가 정확한지 다시 확인해 주세요.";
export const DIRECT_LOOKUP_MISS_SECONDARY = "국가법령정보센터에 수록되지 않았거나 공개 범위가 다른 판결은 대한민국 법원의 판결서 인터넷열람 또는 판결서사본 제공신청에서 확인할 수 있는 경우가 있습니다.";
export const SEARCH_STATUS_LABELS = Object.freeze({
  SUCCESS: "검색 완료",
  NO_RESULT: "검색 완료 · 결과 없음",
  SEARCH_FAILED: "원문 검증 실패",
  SAFETY_REJECTED: "안전 검증으로 표시 차단",
  LUNA_RUNTIME_UNAVAILABLE: "Luna runtime 사용 불가",
  NETWORK_SERVER_ERROR: "서버 오류",
});
