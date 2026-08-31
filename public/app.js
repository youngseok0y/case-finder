const form = document.querySelector("#ask-form");
const queryInput = document.querySelector("#query");
const searchButton = document.querySelector("#search-button");
const result = document.querySelector("#result");
const searchStatus = document.querySelector("#search-status");
const statusMessage = document.querySelector("#status-message");
const progressPanel = document.querySelector("#progress-panel");
const progressLabel = document.querySelector("#progress-label");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const exampleChips = [...document.querySelectorAll("[data-example]")];
const examplePrompts = document.querySelector("#example-prompts");
const serviceStatus = document.querySelector("#service-status");
const refreshStatus = document.querySelector("#refresh-status");
const toast = document.querySelector("#toast");

const EVENT_RANK = {
  SEARCH_STARTED: 0,
  ROUTE_IDENTIFIED: 1,
  ANALYSIS_COMPLETE: 2,
  LAW_EVIDENCE_UPDATED: 3,
  CANDIDATES_FOUND: 4,
  DETAIL_VERIFIED: 5,
  FINALIZING: 6,
  MODEL_FALLBACK: 6,
  SEARCH_COMPLETE: 7,
  SEARCH_FAILED: 7,
};

const FAILURE_HEADINGS = Object.freeze({
  SEARCH_FAILED: "검색 검증에 실패했습니다",
  SAFETY_REJECTED: "결과를 표시하지 않았습니다",
  NO_RESULT: "표시할 결과가 없습니다",
  LUNA_RUNTIME_UNAVAILABLE: "검색 엔진을 사용할 수 없습니다",
  NETWORK_SERVER_ERROR: "검색을 완료하지 못했습니다",
});

const TERMINAL_STATUS = Object.freeze({
  SUCCESS: ["검색을 완료했습니다.", "success"],
  PARTIAL_VERIFIED: ["검색 완료 · 일부 결과를 확인했습니다.", "notice"],
  NO_RESULT: ["검색 완료 · 표시할 결과가 없습니다.", "notice"],
  SEARCH_FAILED: ["검색 검증에 실패했습니다.", "error"],
  SAFETY_REJECTED: ["안전 검증으로 결과 표시가 차단되었습니다.", "error"],
  LUNA_RUNTIME_UNAVAILABLE: ["Luna runtime을 사용할 수 없습니다.", "error"],
  NETWORK_SERVER_ERROR: ["서버 오류로 검색을 완료하지 못했습니다.", "error"],
});

let searching = false;
let lastProgressRank = -1;
let fallbackToastShown = false;
let fallbackToastTimer = null;

function setStatus(message, state = "idle") {
  statusMessage.textContent = message;
  searchStatus.dataset.state = state;
}

function setExampleVisibility(terminalState) {
  if (examplePrompts) examplePrompts.hidden = terminalState === "NO_RESULT";
}

function addRetryAction() {
  const panel = result.querySelector(".state-panel");
  if (!panel || panel.querySelector('[data-action="retry"]')) return;
  const actions = document.createElement("div");
  actions.className = "cta-row";
  const button = document.createElement("button");
  button.className = "secondary-button";
  button.type = "button";
  button.dataset.action = "retry";
  button.textContent = "다시 검색";
  actions.append(button);
  panel.append(actions);
}

function addRelatedHint() {
  const section = result.querySelector(".result-section");
  const related = section?.querySelectorAll(".match-label.is-related");
  if (!section || !related?.length || section.querySelector(".related-hint")) return;
  const details = document.createElement("details");
  details.className = "related-hint";
  const summary = document.createElement("summary");
  summary.textContent = "관련 판례란?";
  const explanation = document.createElement("p");
  const hasDirect = section.querySelector(".match-label:not(.is-related)");
  explanation.textContent = hasDirect
    ? "직접 관련 판례와 함께 질문의 쟁점이 비슷한 판례도 포함되어 있어요."
    : "질문과 정확히 일치하는 판례를 찾지 못해 쟁점이 비슷한 판례를 보여드려요.";
  details.append(summary, explanation);
  section.insertBefore(details, section.querySelector(".case-card"));
}

function resetProgress() {
  lastProgressRank = -1;
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  progressLabel.textContent = "검색을 시작했습니다.";
}

function handleProgress(payload) {
  const event = payload?.event;
  const rank = EVENT_RANK[event];
  if (!Number.isInteger(rank) || (rank < lastProgressRank && event !== "SEARCH_FAILED")) return;
  lastProgressRank = Math.max(lastProgressRank, rank);
  progressLabel.textContent = payload.label || "검색 중…";
  progressPercent.textContent = `${Math.max(0, Math.min(100, Number(payload.percent) || 0))}%`;
  progressBar.style.width = progressPercent.textContent;
  setStatus(payload.label || "검색 중…", "loading");
}

function showFailure(payload) {
  const message = payload?.message || "검색 처리 중 오류가 발생했습니다.";
  const heading = FAILURE_HEADINGS[payload?.terminalState] || "검색을 완료하지 못했습니다";
  result.innerHTML = `<section class="state-panel state-error"><h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message)}</p></section>`;
  setStatus(message, "error");
  setExampleVisibility(payload?.terminalState);
  addRetryAction();
}

function showFallbackToast(payload) {
  if (fallbackToastShown
    || payload?.fallbackApplied !== true
    || payload?.requestedModel !== "gpt-5.6-luna"
    || payload?.effectiveModel !== "gpt-5.6-terra"
    || !toast) return;
  fallbackToastShown = true;
  toast.textContent = "Luna를 사용할 수 없어 Terra로 검색했어요.";
  toast.hidden = false;
  window.clearTimeout(fallbackToastTimer);
  fallbackToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 7_000);
}

function showTerminalStatus(payload) {
  const terminalState = payload?.result?.terminalState || payload?.terminalState || "SUCCESS";
  const [message, state] = TERMINAL_STATUS[terminalState] || TERMINAL_STATUS.NETWORK_SERVER_ERROR;
  setStatus(message, state);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function processSseBlock(block, onEvent) {
  const lines = block.split(/\r?\n/u);
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7) || "message";
  const data = lines.filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
  if (!data) return;
  try { onEvent(event, JSON.parse(data)); } catch { onEvent("SEARCH_FAILED", { terminalState: "NETWORK_SERVER_ERROR", message: "검색 결과를 읽지 못했습니다." }); }
}

async function consumeStream(response) {
  if (!response.body) throw new Error("스트리밍 응답을 읽을 수 없습니다.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalReceived = false;
  let failed = false;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      processSseBlock(block, (event, payload) => {
        if (event === "FINAL") {
          finalReceived = true;
          if (payload.html) result.innerHTML = payload.html;
          setExampleVisibility(payload?.result?.terminalState || payload?.terminalState);
          addRetryAction();
          addRelatedHint();
          showTerminalStatus(payload);
        } else if (event === "SEARCH_FAILED") {
          failed = true;
          showFailure(payload);
        } else if (event === "MODEL_FALLBACK") {
          showFallbackToast(payload);
          handleProgress(payload);
        } else {
          handleProgress(payload);
        }
      });
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (!finalReceived && !failed) throw new Error("검색 결과가 끝나기 전에 연결이 종료됐습니다.");
}
result.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('[data-action="retry"]')) return;
  form.requestSubmit();
});


async function submitSearch(event) {
  event.preventDefault();
  if (searching) return;
  const query = queryInput.value.trim();
  if (!query) {
    queryInput.focus();
    setStatus("검색 질문을 입력해 주세요.", "error");
    return;
  }
  searching = true;
  searchButton.disabled = true;
  searchButton.textContent = "검색 중…";
  resetProgress();
  fallbackToastShown = false;
  window.clearTimeout(fallbackToastTimer);
  if (toast) toast.hidden = true;
  progressPanel.hidden = false;
  setStatus("검색을 시작했습니다.", "loading");
  try {
    const response = await fetch("/ask/stream", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await consumeStream(response);
  } catch (error) {
    showFailure({ terminalState: "NETWORK_SERVER_ERROR", message: `검색 처리 중 오류가 발생했습니다: ${error.message}` });
  } finally {
    progressPanel.hidden = true;
    searching = false;
    searchButton.disabled = false;
    searchButton.textContent = "검색";
  }
}

function renderServiceStatus(payload) {
  if (!payload) return;
  const engine = payload.adapter?.label || "확인 불가";
  const mcp = payload.mcp || {};
  const law = mcp.providerReady === true
    ? "연결됨"
    : mcp.ocConfigured === false
      ? "인증키 설정 필요"
      : "연결 확인 필요";
  const adapterId = payload.adapter?.id;
  let usageTitle = "Codex 사용량";
  let usageLabel;
  if (adapterId === "gemini_d") {
    const geminiLabel = payload.quota?.gemini?.label;
    usageTitle = "Gemini 사용량";
    usageLabel = typeof geminiLabel === "string" && geminiLabel.trim() ? geminiLabel : "확인할 수 없음";
  } else {
    const quota = payload.quota?.codexQuota || {};
    const windowSuffix = quota.windowLabel ? ` / ${quota.windowLabel}` : "";
    const remaining = quota.remainingPercent === null || quota.remainingPercent === undefined || quota.remainingPercent === ""
      ? null
      : Number(quota.remainingPercent);
    usageLabel = quota.loggedIn === false
      ? "로그인 필요"
      : quota.available === true && Number.isFinite(remaining)
        ? `${Math.max(0, Math.min(100, remaining))}% 남음${windowSuffix}`
        : "확인할 수 없음";
  }
  serviceStatus.innerHTML = `<div><span>검색 엔진</span><strong>${escapeHtml(engine)}</strong></div><div><span>법령 API</span><strong>${escapeHtml(law)}</strong></div><div><span>${escapeHtml(usageTitle)}</span><strong>${escapeHtml(usageLabel)}</strong></div>`;
}

async function loadServiceStatus() {
  try {
    const response = await fetch("/health", { cache: "no-store" });
    renderServiceStatus(await response.json());
  } catch {
    serviceStatus.innerHTML = "<div><span>검색 엔진</span><strong>상태 확인 불가</strong></div><div><span>법령 API</span><strong>상태 확인 불가</strong></div><div><span>Codex 사용량</span><strong>확인할 수 없음</strong></div>";
  }
}

form.addEventListener("submit", submitSearch);
refreshStatus.addEventListener("click", loadServiceStatus);
for (const chip of exampleChips) {
  chip.addEventListener("click", () => {
    queryInput.value = chip.dataset.example;
    queryInput.focus();
  });
}
loadServiceStatus();
