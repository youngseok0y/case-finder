const form = document.querySelector("#settings-form");
const message = document.querySelector("#form-message");
const fields = ["SEARCH_ADAPTER", "CODEX_TIMEOUT_MS", "PORT", "SEARCH_DISPLAY", "GCP_PROJECT_ID"];
const codexStatus = document.querySelector("#codex-status");
const codexEmail = document.querySelector("#codex-email");
const codexPlan = document.querySelector("#codex-plan");
const codexWeekly = document.querySelector("#codex-weekly");
const codexReset = document.querySelector("#codex-reset");
const codexLoginMessage = document.querySelector("#codex-login-message");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#b42318" : "#667085";
}

function setConfigured(id, configured) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = configured ? "현재 설정됨 · 실제 값은 표시하지 않음" : "현재 설정되지 않음";
}

async function loadSettings() {
  try {
    const response = await fetch("/admin/config", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    document.querySelector("#SEARCH_ADAPTER").value = payload.adapter;
    document.querySelector("#CODEX_TIMEOUT_MS").value = payload.values.codexTimeoutMs;
    document.querySelector("#PORT").value = payload.values.port;
    document.querySelector("#SEARCH_DISPLAY").value = payload.values.searchDisplay;
    setConfigured("gemini-configured", payload.configured.geminiApiKey);
    setConfigured("law-configured", payload.configured.lawOc);
    setConfigured("gcp-configured", payload.configured.gcpProjectId);
  } catch (error) {
    setMessage(`설정을 읽지 못했습니다: ${error.message}`, true);
  }
}

function setCodexMessage(text, isError = false) {
  codexLoginMessage.textContent = text;
  codexLoginMessage.style.color = isError ? "#b42318" : "#667085";
}

async function loadCodexStatus() {
  try {
    const accountResponse = await fetch("/api/codex/account", { cache: "no-store" });
    const account = await accountResponse.json();
    if (!accountResponse.ok) throw new Error(account.message || `HTTP ${accountResponse.status}`);
    const loggedIn = account.loggedIn === true;
    const weekly = account.codexWeekly || {};
    codexStatus.textContent = loggedIn
      ? "로그인됨"
      : "로그인 필요 · GPT 계정 변경 또는 Device code 로그인을 시작하세요.";
    codexEmail.textContent = loggedIn ? (account.email || "이메일 미제공") : "로그인 필요";
    codexPlan.textContent = loggedIn ? (account.planType || "확인되지 않음") : "로그인 필요";
    if (!loggedIn) {
      codexWeekly.textContent = "로그인 필요";
      codexReset.textContent = "로그인 필요";
    } else if (weekly.available === true && Number.isFinite(Number(weekly.usedPercent)) && Number.isFinite(Number(weekly.remainingPercent))) {
      const used = Math.max(0, Math.min(100, Number(weekly.usedPercent)));
      const remaining = Math.max(0, Math.min(100, Number(weekly.remainingPercent)));
      codexWeekly.textContent = `${used}% 사용 · ${remaining}% 남음`;
      codexReset.textContent = weekly.resetLabel || "확인할 수 없음";
    } else {
      codexWeekly.textContent = "확인할 수 없음";
      codexReset.textContent = "확인할 수 없음";
    }
    return account;
  } catch (error) {
    codexStatus.textContent = `Codex 상태를 읽지 못했습니다: ${error.message}`;
    codexEmail.textContent = "확인할 수 없음";
    codexPlan.textContent = "확인할 수 없음";
    codexWeekly.textContent = "확인할 수 없음";
    codexReset.textContent = "확인할 수 없음";
    return null;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function pollForLogin(popup) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const account = await loadCodexStatus();
    if (account?.loggedIn === true && account?.pendingLogin !== true) {
      popup?.close?.();
      setCodexMessage(`로그인 계정을 확인했습니다: ${account.email || "이메일 미제공"}`);
      return;
    }
    await wait(1_000);
  }
  setCodexMessage("로그인 완료를 아직 확인하지 못했습니다. 새로고침으로 상태를 다시 확인해 주세요.", true);
}

async function startCodexLogin(type) {
  setCodexMessage("로그인 준비 중…");
  const popup = type === "chatgpt"
    ? window.open("", "codex-login", "width=720,height=760")
    : null;
  if (type === "chatgpt" && !popup) {
    setCodexMessage("브라우저 로그인 팝업이 차단되었습니다. 팝업을 허용하거나 Device code 로그인을 사용해 주세요.", true);
    return;
  }
  try {
    const response = await fetch("/api/codex/login/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    if (body.authUrl && popup) popup.location.href = body.authUrl;
    setCodexMessage(body.authUrl
      ? "브라우저 로그인 창을 열었습니다. 로그인 완료를 확인하고 있습니다."
      : `Device code: ${body.userCode || "확인되지 않음"} · ${body.verificationUrl || "URL 확인되지 않음"}`);
    void pollForLogin(popup);
  } catch (error) {
    popup?.close?.();
    setCodexMessage(`로그인을 시작하지 못했습니다: ${error.message}`, true);
  }
}

async function cancelCodexLogin() {
  try {
    const response = await fetch("/api/codex/login/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    setCodexMessage(body.cancelled ? "로그인을 취소했습니다." : "진행 중인 로그인이 없습니다.");
    await loadCodexStatus();
  } catch (error) {
    setCodexMessage(`로그인을 취소하지 못했습니다: ${error.message}`, true);
  }
}

async function logoutCodex() {
  try {
    const response = await fetch("/api/codex/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    setCodexMessage("로그아웃했습니다.");
    await loadCodexStatus();
  } catch (error) {
    setCodexMessage(`로그아웃하지 못했습니다: ${error.message}`, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {};
  for (const id of fields) payload[id] = document.querySelector(`#${id}`).value;
  for (const id of ["GEMINI_API_KEY", "LAW_OC"]) {
    const value = document.querySelector(`#${id}`).value;
    if (value) payload[id] = value;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  setMessage("저장 중…");
  try {
    const response = await fetch("/admin/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    form.querySelector("#GEMINI_API_KEY").value = "";
    form.querySelector("#LAW_OC").value = "";
    setMessage(body.message || "설정이 저장되었습니다.");
  } catch (error) {
    setMessage(`저장하지 못했습니다: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#codex-browser-login").addEventListener("click", () => startCodexLogin("chatgpt"));
document.querySelector("#codex-device-login").addEventListener("click", () => startCodexLogin("chatgptDeviceCode"));
document.querySelector("#codex-cancel-login").addEventListener("click", cancelCodexLogin);
document.querySelector("#codex-logout").addEventListener("click", logoutCodex);
document.querySelector("#codex-refresh").addEventListener("click", loadCodexStatus);

loadSettings();
loadCodexStatus();
