// Goals dashboard: reads data.json and draws the whole page from it.
// Changes made on the page (ticking tasks, accepting suggestions) live only in
// memory, so a reload starts again from data.json.

let data;

// ---------- small helpers ----------

// Build an element: el("p", { class: "x" }, "text", childElement, ...)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function goalById(id) {
  return data.goals.find((g) => g.id === id);
}

// The five areas, in the order they first appear in data.goals.
function areas() {
  return [...new Set(data.goals.map((g) => g.area))];
}

function areaOf(goalId) {
  const goal = goalById(goalId);
  return goal ? goal.area : "Other";
}

// Each area gets its own accent color (see .area-0 ... .area-4 in style.css).
function areaClass(area) {
  return "area-" + Math.max(0, areas().indexOf(area));
}

function areaChip(area) {
  return el("span", { class: "chip " + areaClass(area) }, area);
}

const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// "2027-01-03" -> "Jan 3, 2027". Anything else (like "Every week") is shown as is.
function formatDate(s) {
  if (!s) return "No date yet";
  if (!isIsoDate(s)) return s;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// "2026-10" -> "Oct 2026"
function formatMonth(s) {
  if (!/^\d{4}-\d{2}$/.test(s)) return s || "";
  const [y, m] = s.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Log entries, newest first (entries on the same day keep their file order).
function sortedLog() {
  return data.log
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || a.i - b.i)
    .map((x) => x.entry);
}

// ---------- Next up ----------

function renderNext() {
  const list = document.getElementById("next-list");
  list.replaceChildren();

  if (data.next.length === 0) {
    list.append(el("li", { class: "empty" }, "Nothing queued. Nice."));
    return;
  }

  data.next.forEach((item, i) => {
    list.append(
      el("li", { class: "next-item " + areaClass(areaOf(item.goal)) },
        el("button", {
          type: "button", class: "check", "aria-label": "Mark done: " + item.task,
          onclick: () => finishTask(i),
        }),
        el("div", { class: "next-body" },
          el("span", { class: "next-task" }, item.task),
          el("span", { class: "next-meta" }, areaChip(areaOf(item.goal)), el("span", { class: "time" }, item.time)),
        ),
        el("div", { class: "move" },
          el("button", {
            type: "button", class: "icon-btn", "aria-label": "Move up", disabled: i === 0 ? "" : null,
            onclick: () => moveTask(i, -1),
          }, "↑"),
          el("button", {
            type: "button", class: "icon-btn", "aria-label": "Move down",
            onclick: () => moveTask(i, 1),
          }, "↓"),
        ),
      ),
    );
  });

  list.lastElementChild.querySelector('[aria-label="Move down"]').disabled = true;
}

function moveTask(i, direction) {
  const j = i + direction;
  if (j < 0 || j >= data.next.length) return;
  [data.next[i], data.next[j]] = [data.next[j], data.next[i]];
  renderAll();
}

// Finished items leave Next up and become a log entry dated today.
function finishTask(i) {
  const [item] = data.next.splice(i, 1);
  data.log.unshift({ date: today(), goal: item.goal, note: item.task + "." });
  renderAll();
}

// ---------- Goal cards ----------

function renderGoalStatus(goal) {
  const hasBar = typeof goal.target === "number" && goal.target > 0;
  return el("div", { class: "goal" },
    el("h4", {}, goal.name),
    hasBar
      ? el("div", {},
          el("div", {
            class: "bar", role: "progressbar",
            "aria-valuemin": "0", "aria-valuemax": String(goal.target), "aria-valuenow": String(goal.done ?? 0),
            "aria-label": goal.name,
          }, el("div", { class: "bar-fill", style: `width: ${Math.min(100, ((goal.done ?? 0) / goal.target) * 100)}%` })),
          el("p", { class: "count" }, `${goal.done ?? 0} of ${goal.target} ${goal.unit || ""}`.trim()),
        )
      : el("p", { class: "count" }, "No progress bar, just the log."),
    goal.steps && el("ul", { class: "steps" },
      goal.steps.map((step, i) => el("li", { class: i < (goal.done ?? 0) ? "done" : "" }, step)),
    ),
    goal.recipePicks && el("div", { class: "picks" },
      el("p", { class: "label" }, "Recipe picks"),
      el("ul", { class: "mini-log" }, goal.recipePicks.map((r) =>
        el("li", {}, el("span", { class: "date" }, formatMonth(r.month)), " ", `${r.name} (${r.time})`))),
    ),
    el("p", { class: "due" }, el("span", { class: "label" }, "Target: "), dueText(goal)),
  );
}

// "due" can be a date, words like "Every week", or empty. A goal that repeats
// (like weekly sessions) says so instead of showing a date.
function dueText(goal) {
  if (goal.due) return formatDate(goal.due);
  if (goal.repeats === "weekly") return "Every week";
  if (goal.repeats) return goal.repeats;
  return "No date set";
}

function renderCards() {
  const wrap = document.getElementById("goal-cards");
  wrap.replaceChildren();

  for (const area of areas()) {
    const goals = data.goals.filter((g) => g.area === area);
    const ids = goals.map((g) => g.id);
    const nextStep = data.next.find((n) => ids.includes(n.goal));
    const recent = sortedLog().filter((e) => ids.includes(e.goal)).slice(0, 2);

    wrap.append(
      el("article", { class: "card " + areaClass(area) },
        el("h3", {}, area),
        goals.map(renderGoalStatus),
        el("div", { class: "card-section" },
          el("p", { class: "label" }, "Next step"),
          el("p", {}, nextStep ? `${nextStep.task} (${nextStep.time})` : "Nothing queued yet."),
        ),
        el("div", { class: "card-section" },
          el("p", { class: "label" }, "Recently"),
          recent.length
            ? el("ul", { class: "mini-log" }, recent.map((e) => el("li", {}, el("span", { class: "date" }, formatDate(e.date)), " ", e.note)))
            : el("p", { class: "muted" }, "Nothing logged yet."),
        ),
        el("button", { type: "button", class: "btn", onclick: () => openChat(goals[0]) }, "Talk it through"),
      ),
    );
  }
}

// ---------- Log ----------

function renderLog() {
  const list = document.getElementById("log-list");
  if (data.log.length === 0) {
    list.replaceChildren(el("li", { class: "empty" }, "Nothing logged yet. Tick off a task in Next up and it shows up here."));
    return;
  }
  list.replaceChildren(
    ...sortedLog().map((e) =>
      el("li", {},
        el("span", { class: "date" }, formatDate(e.date)),
        areaChip(areaOf(e.goal)),
        el("span", { class: "note" }, e.note),
      ),
    ),
  );
}

// ---------- Tried ----------

const triedIcons = { "done": "✓", "keeping": "★", "ruled out": "✕" };

function renderTried() {
  const list = document.getElementById("tried-list");
  if (data.tried.length === 0) {
    list.replaceChildren(el("li", { class: "empty" }, "Nothing here yet. Add things you try to the tried list in data.json."));
    return;
  }
  list.replaceChildren(
    ...data.tried.map((t) => {
      const kind = t.status.replace(/\s+/g, "-");
      return el("li", { class: "tried " + kind },
        el("span", { class: "tick", "aria-hidden": "true" }, triedIcons[t.status] || "•"),
        el("div", {},
          el("p", {}, el("strong", {}, t.name), " ", el("span", { class: "status" }, t.status), " ", el("span", { class: "date" }, formatMonth(t.date))),
          el("p", { class: "muted" }, t.why),
        ),
      );
    }),
  );
}

// ---------- Talk it through (real AI chat) ----------

// Where the chat server lives (api/chat.js, deployed on Vercel). On the Vercel
// site itself, or with `vercel dev` on your computer, it's just "/api/chat".
// For the GitHub Pages site, paste your Vercel address here, like
// "https://goal-dashboard-asher.vercel.app/api/chat".
const CHAT_API_URL = "";

function chatEndpoint() {
  const host = location.hostname;
  if (host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1") return "/api/chat";
  return CHAT_API_URL;
}

// The passcode is saved in this browser so you only type it once.
const PASSCODE_KEY = "chatPasscode";
function savedPasscode() {
  try { return localStorage.getItem(PASSCODE_KEY) || ""; } catch { return ""; }
}
function savePasscode(code) {
  try { code ? localStorage.setItem(PASSCODE_KEY, code) : localStorage.removeItem(PASSCODE_KEY); } catch { /* private window */ }
}

let chatHistory = []; // [{ role: "user" | "assistant", text }], starting with "user"
let chatArea = "";
let chatRun = 0; // bumps each time the chat opens, so a late answer from an old chat is ignored

function describeSuggestion(s, goal) {
  if (s.field === "next") return `Add to Next up: ${s.value.task} (${s.value.time})`;
  if (s.field === "due") return `Change the ${goal.name} target date to ${formatDate(s.value)}`;
  if (s.field === "target") return `Change the ${goal.name} target to ${s.value} ${goal.unit || ""}`.trim();
  return `Change ${goal.name} ${s.field} to ${s.value}`;
}

function applySuggestion(s, goal) {
  if (s.field === "next") {
    // Suggested steps go just below the current top item.
    data.next.splice(Math.min(1, data.next.length), 0, { ...s.value, goal: goal.id });
  } else {
    goal[s.field] = s.value;
  }
  renderAll();
}

// The Edit form: lets you change the suggested value before accepting it.
function editForm(s, onSave, onCancel) {
  let inputs;
  if (s.field === "next") {
    inputs = [
      el("input", { type: "text", "aria-label": "Task", value: s.value.task }),
      el("input", { type: "text", "aria-label": "How long", value: s.value.time }),
    ];
  } else if (s.field === "due" && isIsoDate(s.value)) {
    inputs = [el("input", { type: "date", "aria-label": "Target date", value: s.value })];
  } else {
    inputs = [el("input", { type: typeof s.value === "number" ? "number" : "text", "aria-label": s.field, value: String(s.value) })];
  }

  const form = el("form", { class: "edit-form" },
    inputs,
    el("div", { class: "actions" },
      el("button", { type: "submit", class: "btn small" }, "Save"),
      el("button", { type: "button", class: "btn small ghost", onclick: onCancel }, "Cancel"),
    ),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    let value;
    if (s.field === "next") value = { task: inputs[0].value.trim(), time: inputs[1].value.trim() };
    else if (typeof s.value === "number") value = Number(inputs[0].value);
    else value = inputs[0].value;
    onSave({ ...s, value });
  });
  return form;
}

// Shows a suggestion with Accept / Edit / Skip and resolves once one is chosen.
function suggestionBox(s, goal) {
  return new Promise((resolve) => {
    const box = el("div", { class: "suggestion" });

    const finish = (text) => {
      box.replaceChildren(el("p", { class: "resolved" }, text));
      resolve();
    };

    const showButtons = () => {
      box.replaceChildren(
        el("p", {}, describeSuggestion(s, goal)),
        el("div", { class: "actions" },
          el("button", { type: "button", class: "btn small", onclick: () => { applySuggestion(s, goal); finish("Accepted: " + describeSuggestion(s, goal)); } }, "Accept"),
          el("button", { type: "button", class: "btn small ghost", onclick: showEdit }, "Edit"),
          el("button", { type: "button", class: "btn small ghost", onclick: () => finish("Skipped.") }, "Skip"),
        ),
      );
    };

    const showEdit = () => {
      box.replaceChildren(
        editForm(s, (edited) => { applySuggestion(edited, goal); finish("Accepted with your edit: " + describeSuggestion(edited, goal)); }, showButtons),
      );
      box.querySelector("input").focus();
    };

    showButtons();
    document.getElementById("chat-messages").lastElementChild.append(box);
  });
}

// The server sends { goal, field, value, time } with value always a string.
// Turn it into the shape suggestionBox uses, or null if it doesn't fit the data.
function toSuggestion(raw) {
  const goal = goalById(raw.goal);
  if (!goal) return null;
  if (raw.field === "next" && raw.value.trim()) {
    return { goal, s: { field: "next", value: { task: raw.value.trim(), time: raw.time.trim() || "a bit" } } };
  }
  if (raw.field === "due" && isIsoDate(raw.value)) return { goal, s: { field: "due", value: raw.value } };
  if (raw.field === "target" && typeof goal.target === "number" && Number(raw.value) > 0) {
    return { goal, s: { field: "target", value: Number(raw.value) } };
  }
  return null;
}

function addMessage(from, text) {
  const messages = document.getElementById("chat-messages");
  const bubble = el("div", { class: "msg " + from }, el("p", {}, text));
  messages.append(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function addNotice(text) {
  const messages = document.getElementById("chat-messages");
  messages.append(el("p", { class: "chat-end" }, text));
  messages.scrollTop = messages.scrollHeight;
}

function setChatBusy(busy) {
  const form = document.getElementById("chat-form");
  form.elements.text.disabled = busy;
  form.elements.send.disabled = busy;
  form.elements.send.textContent = busy ? "Thinking…" : "Send";
  if (!busy) form.elements.text.focus();
}

// Asks for the passcode inside the chat, then sends again.
function askPasscode(note) {
  const messages = document.getElementById("chat-messages");
  const input = el("input", { type: "password", "aria-label": "Chat passcode", placeholder: "Passcode", autocomplete: "current-password" });
  const form = el("form", { class: "suggestion passcode" },
    el("p", {}, note),
    input,
    el("div", { class: "actions" }, el("button", { type: "submit", class: "btn small" }, "Save and send")),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input.value.trim()) return;
    savePasscode(input.value.trim());
    form.remove();
    sendChat();
  });
  messages.append(form);
  messages.scrollTop = messages.scrollHeight;
  input.focus();
}

// Sends the conversation so far and shows the answer.
async function sendChat() {
  const url = chatEndpoint();
  if (!url) {
    addNotice("The AI chat isn't connected on this site yet. See \"Real AI chat\" in the README.");
    return;
  }
  const passcode = savedPasscode();
  if (!passcode) {
    askPasscode("Type the chat passcode (the CHAT_PASSCODE you set in Vercel).");
    return;
  }

  const run = chatRun;
  setChatBusy(true);
  let result;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Chat-Passcode": passcode },
      body: JSON.stringify({ area: chatArea, dashboard: data, history: chatHistory }),
    });
    result = await res.json().catch(() => ({ error: "The chat server sent back something odd (HTTP " + res.status + ")." }));
    if (res.status === 401) result.needsPasscode = true;
    else if (!res.ok && !result.error) result.error = "Something went wrong (HTTP " + res.status + ").";
  } catch {
    result = { error: "Couldn't reach the chat server. Check your internet, or the address in CHAT_API_URL." };
  }
  if (run !== chatRun) return; // the chat was closed or reopened meanwhile
  setChatBusy(false);

  if (result.needsPasscode) {
    savePasscode("");
    askPasscode("That passcode didn't work. Try again.");
    return;
  }
  if (result.error) {
    addNotice(result.error);
    return;
  }

  chatHistory.push({ role: "assistant", text: result.reply });
  addMessage("ai", result.reply);
  for (const raw of result.suggestions || []) {
    const fit = toSuggestion(raw);
    if (fit) suggestionBox(fit.s, fit.goal);
  }
}

function openChat(fromGoal) {
  const dialog = document.getElementById("chat");
  chatRun++;
  chatHistory = [];
  chatArea = fromGoal.area;

  document.getElementById("chat-title").textContent = "Talk it through: " + fromGoal.area;
  document.getElementById("chat-note").textContent = "Chat with Claude about this goal. Suggestions only change the page after you accept them.";
  document.getElementById("chat-messages").replaceChildren();
  addMessage("ai", "What's on your mind about " + fromGoal.area.toLowerCase() + "?");
  setChatBusy(false);
  if (!dialog.open) dialog.showModal();
  document.getElementById("chat-form").elements.text.focus();
}

document.getElementById("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = event.target.elements.text;
  const text = input.value.trim();
  if (!text || input.disabled) return;
  input.value = "";

  // If the last try failed, Asher's message is still the last turn: replace it.
  if (chatHistory.at(-1)?.role === "user") chatHistory.pop();
  chatHistory.push({ role: "user", text });
  addMessage("me", text);
  sendChat();
});

document.getElementById("chat-close").addEventListener("click", () => {
  chatRun++;
  document.getElementById("chat").close();
});
document.getElementById("chat").addEventListener("close", () => { chatRun++; });

// ---------- start ----------

function renderAll() {
  renderNext();
  renderCards();
  renderLog();
  renderTried();
}

fetch("data.json")
  .then((res) => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  })
  .then((json) => {
    data = json;
    renderAll();
  })
  .catch((err) => {
    document.querySelector("main").replaceChildren(
      el("div", { class: "load-error" },
        el("h2", {}, "Couldn't load data.json"),
        el("p", {}, "Browsers block a page opened straight from your files from reading other files. Run a tiny local server in this folder instead, for example:"),
        el("pre", {}, "python -m http.server 8000"),
        el("p", {}, "then open http://localhost:8000. On GitHub Pages it works without this."),
        el("p", { class: "muted" }, String(err)),
      ),
    );
  });
