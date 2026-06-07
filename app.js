const form = document.querySelector("#promptForm");
const promptInput = document.querySelector("#promptInput");
const runButton = document.querySelector("#runButton");
const conversation = document.querySelector("#conversation");
const activityLog = document.querySelector("#activityLog");
const historyToggle = document.querySelector("#historyToggle");
const historyPanel = document.querySelector("#historyPanel");
const historyClose = document.querySelector("#historyClose");
const historyList = document.querySelector("#historyList");
const clearHistory = document.querySelector("#clearHistory");
const tabButtons = document.querySelectorAll(".tab-button");
const previewTab = document.querySelector("#previewTab");
const codeTab = document.querySelector("#codeTab");
const activityTab = document.querySelector("#activityTab");
const previewSelect = document.querySelector("#previewSelect");
const previewFrame = document.querySelector("#previewFrame");
const refreshPreview = document.querySelector("#refreshPreview");
const fileSelect = document.querySelector("#fileSelect");
const codeView = document.querySelector("#codeView");
const historyKey = "miniCursorHistory";
const appFiles = new Set([
  "index.js",
  "package.json",
  "package-lock.json",
  "public/app.js",
  "public/index.html",
  "public/style.css",
]);

function addMessage(role, text) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.innerHTML = `
    <strong>${role === "user" ? "You" : "Mini Cursor"}</strong>
    <p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>
  `;
  conversation.appendChild(article);
  conversation.scrollTop = conversation.scrollHeight;
}

function addActivity(type, text) {
  const item = document.createElement("div");
  item.className = `activity-item ${type}`;
  item.textContent = type === "command" ? `> ${text}` : text;
  activityLog.appendChild(item);
  activityLog.scrollTop = activityLog.scrollHeight;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(historyKey)) || [];
  } catch {
    return [];
  }
}

function saveHistoryItem(prompt, reply, steps) {
  const history = getHistory();
  history.unshift({
    id: crypto.randomUUID(),
    prompt,
    reply,
    steps,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(historyKey, JSON.stringify(history.slice(0, 30)));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  historyList.innerHTML = "";

  if (history.length === 0) {
    historyList.innerHTML = '<div class="history-empty">No history yet.</div>';
    return;
  }

  for (const item of history) {
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";
    button.innerHTML = `
      <strong>${escapeHtml(item.prompt)}</strong>
      <span>${new Date(item.createdAt).toLocaleString()}</span>
    `;
    button.addEventListener("click", () => openHistoryItem(item));
    historyList.appendChild(button);
  }
}

function openHistoryItem(item) {
  conversation.innerHTML = "";
  activityLog.innerHTML = "";
  addMessage("user", item.prompt);
  addMessage("assistant", item.reply);

  for (const step of item.steps || []) {
    addActivity(step.type, step.command || step.output);
  }

  closeHistory();
}

function openHistory() {
  historyPanel.classList.add("open");
  historyPanel.setAttribute("aria-hidden", "false");
}

function closeHistory() {
  historyPanel.classList.remove("open");
  historyPanel.setAttribute("aria-hidden", "true");
}

function setActiveTab(tabName) {
  for (const button of tabButtons) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }

  previewTab.classList.toggle("active", tabName === "preview");
  codeTab.classList.toggle("active", tabName === "code");
  activityTab.classList.toggle("active", tabName === "activity");
}

async function refreshWorkspaceView() {
  const response = await fetch("/api/files");
  const data = await response.json();
  const files = (data.files || []).filter((file) => !appFiles.has(file) && !file.startsWith("public/"));
  const codeFiles = files.filter((file) => /\.(html|css|js|json|md|txt)$/i.test(file));
  const previewFiles = files.filter((file) => /(^|\/)index\.html$/i.test(file));

  fileSelect.innerHTML = '<option value="">Select a file</option>';
  for (const file of codeFiles) {
    const option = document.createElement("option");
    option.value = file;
    option.textContent = file;
    fileSelect.appendChild(option);
  }

  previewSelect.innerHTML = "";
  if (previewFiles.length === 0) {
    previewSelect.innerHTML = '<option value="">No preview yet</option>';
    previewFrame.removeAttribute("src");
    previewFrame.srcdoc = "<p style=\"font-family: system-ui; padding: 20px; color: #555;\">Build a project first, then preview will appear here.</p>";
  } else {
    previewFrame.removeAttribute("srcdoc");
    for (const file of previewFiles) {
      const option = document.createElement("option");
      option.value = file;
      option.textContent = file;
      previewSelect.appendChild(option);
    }
    previewSelect.value = previewFiles[previewFiles.length - 1];
    loadPreview();
  }

  if (codeFiles.length > 0 && !fileSelect.value) {
    fileSelect.value = codeFiles[0];
    await loadCodeFile();
  }
}

function loadPreview() {
  if (!previewSelect.value) {
    return;
  }

  const previewPath = previewSelect.value.split("/").map(encodeURIComponent).join("/");
  previewFrame.src = `/preview/${previewPath}?t=${Date.now()}`;
}

async function loadCodeFile() {
  if (!fileSelect.value) {
    codeView.textContent = "Generated code will appear here.";
    return;
  }

  codeView.textContent = "Loading...";

  try {
    const response = await fetch(`/api/file?path=${encodeURIComponent(fileSelect.value)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not read file.");
    }

    codeView.textContent = data.content;
  } catch (error) {
    codeView.textContent = error.message;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompt = promptInput.value.trim();
  if (!prompt) {
    promptInput.focus();
    return;
  }

  addMessage("user", prompt);
  promptInput.value = "";
  runButton.disabled = true;
  runButton.textContent = "Building";
  activityLog.innerHTML = "";
  addActivity("command", "Starting agent...");
  setActiveTab("activity");

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    for (const step of data.steps || []) {
      addActivity(step.type, step.command || step.output);
    }

    addMessage("assistant", data.reply || "Done.");
    saveHistoryItem(prompt, data.reply || "Done.", data.steps || []);
    await refreshWorkspaceView();
    setActiveTab("preview");
  } catch (error) {
    addActivity("error", error.message);
    addMessage("assistant", `Something went wrong: ${error.message}`);
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Build";
  }
});

historyToggle.addEventListener("click", openHistory);
historyClose.addEventListener("click", closeHistory);
previewSelect.addEventListener("change", loadPreview);
refreshPreview.addEventListener("click", loadPreview);
fileSelect.addEventListener("change", loadCodeFile);

for (const button of tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
}

clearHistory.addEventListener("click", () => {
  localStorage.removeItem(historyKey);
  renderHistory();
});

renderHistory();
refreshWorkspaceView();
