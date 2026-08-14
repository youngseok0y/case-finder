const form = document.querySelector("#settings-form");
const message = document.querySelector("#form-message");
const fields = ["SEARCH_ADAPTER", "CODEX_TIMEOUT_MS", "PORT", "SEARCH_DISPLAY", "GCP_PROJECT_ID"];

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

loadSettings();
