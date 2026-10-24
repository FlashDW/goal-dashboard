// My goals: log in, see your dashboard (Next up, This week, goal cards, Log and
// Tried), and tell the coach in the chat what happened so it updates them.
// Everything you see comes from the server (the api/ folder on Vercel), so it's
// still there when you reload or switch devices.

import { weekStart, addDays, daysBetween, weeklyStats } from "./week.js";

// Where the server lives. On the Vercel site itself, or with `vercel dev` on
// your computer, it's the same address as the page. The GitHub Pages site uses
// the Vercel project's main address.
const SERVER_URL = "https://goal-dashboard-one.vercel.app";

function api(path) {
  const host = location.hostname;
  const sameSite = host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1";
  return (sameSite ? "" : SERVER_URL) + "/api/" + path;
}

// The sign-in token is kept in this browser so you stay logged in.
const TOKEN_KEY = "goalsToken";
function savedToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
function saveToken(token) {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private window */ }
}

// Calls the server and returns { ok, status, data }. Never throws.
async function call(path, { method = "GET", body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const token = savedToken();
  if (token) headers.Authorization = "Bearer " + token;
  try {
    const res = await fetch(api(path), { method, headers, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the server. Check your internet and try again." } };
  }
}

// ---------- small helpers ----------

// Build an element: el("p", { class: "x" }, "text", childElement, ...)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

const $ = (id) => document.getElementById(id);

// "2027-01-03" -> "Jan 3" (or "Jan 3, 2027" when it's not this year)
function formatDate(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  const opts = { month: "short", day: "numeric" };
  if (y !== new Date().getFullYear()) opts.year = "numeric";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", opts);
}

// "Today", "Yesterday", "Wednesday" (this week) or "Oct 3"
function dayLabel(s) {
  const ago = daysBetween(s, today());
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago > 1 && ago < 7) return new Date(s + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
  return formatDate(s);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- state ----------

const emptyState = () => ({ user: null, goals: [], todos: [], log: [], tried: [] });
let state = emptyState();

// Every answer from the server carries the whole dashboard; draw it again.
function setLists(data) {
  for (const key of ["goals", "todos", "log", "tried"]) {
    if (Array.isArray(data[key])) state[key] = data[key];
  }
  renderDashboard();
}

const goalById = (id) => state.goals.find((g) => g.id === id);

// ---------- log in / make an account ----------

let mode = "login";

function setMode(next) {
  mode = next;
  $("tab-login").setAttribute("aria-selected", mode === "login");
  $("tab-signup").setAttribute("aria-selected", mode === "signup");
  document.querySelector(".signup-only").hidden = mode !== "signup";
  $("auth-form").invite.required = mode === "signup";
  $("auth-form").password.autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("auth-submit").textContent = mode === "signup" ? "Make my account" : "Log in";
  showAuthError("");
}

function showAuthError(text) {
  $("auth-error").textContent = text;
  $("auth-error").hidden = !text;
}

$("tab-login").addEventListener("click", () => setMode("login"));
$("tab-signup").addEventListener("click", () => setMode("signup"));

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const body = { name: form.name.value, password: form.password.value };
  if (mode === "signup") body.invite = form.invite.value;

  $("auth-submit").disabled = true;
  const { ok, data } = await call(mode === "signup" ? "signup" : "login", { method: "POST", body });
  $("auth-submit").disabled = false;

  if (!ok) return showAuthError(data.error || "That didn't work. Try again.");
  saveToken(data.token);
  form.reset();
  showApp(data);
});

$("logout").addEventListener("click", async () => {
  await call("logout", { method: "POST" });
  saveToken("");
  showAuth();
});

function showAuth() {
  state = emptyState();
  closeChat();
  $("app").hidden = true;
  $("auth").hidden = false;
  setMode(mode);
  $("auth-form").name.focus();
}

function showApp(data) {
  state.user = data.user;
  $("who-name").textContent = data.user.name;
  $("auth").hidden = true;
  $("app").hidden = false;
  setLists(data);
  renderChat(data.messages || []);
  if (!isPhone()) $("chat-form").text.focus();
}

// ---------- taps on the page, with Undo ----------

// Ticking, moving and deleting go to api/edit.js. Each one comes back with an
// undo tag, and a small bar at the bottom offers Undo for a few seconds.
async function edit(action, fields = {}) {
  const { ok, status, data } = await call("edit", { method: "POST", body: { action, today: today(), ...fields } });
  if (status === 401) return showAuth();
  setLists(data);
  if (!ok) return showToast(data.error || "That didn't work. Try again.");
  if (data.undo) showToast(data.change, data.undo);
  return data;
}

let toastTimer;
function showToast(text, turn = null) {
  clearTimeout(toastTimer);
  $("toast-text").textContent = text;
  $("toast-undo").hidden = !turn;
  $("toast-undo").onclick = async () => {
    hideToast();
    const { status, data } = await call("undo", { method: "POST", body: { turn } });
    if (status === 401) return showAuth();
    setLists(data);
  };
  $("toast").hidden = false;
  toastTimer = setTimeout(hideToast, 6000);
}
function hideToast() {
  clearTimeout(toastTimer);
  $("toast").hidden = true;
}

// ---------- the dashboard ----------

const NEXT_SHOWN = 3;
let showAllNext = false;

function renderDashboard() {
  $("start").hidden = state.goals.length > 0 || state.todos.length > 0;
  renderNext();
  renderWeek();
  renderGoals();
  renderLog();
  renderTried();
}

// Next up: one ordered list across every goal. Top 3, or all of them.
function renderNext() {
  const list = $("next-list");
  list.replaceChildren();
  const todos = state.todos;
  if (!todos.length) {
    list.append(el("li", { class: "empty" }, "Nothing here. Ask the coach: \"what should I do next?\""));
  }
  const shown = showAllNext ? todos : todos.slice(0, NEXT_SHOWN);
  shown.forEach((todo, i) => list.append(nextItem(todo, i)));
  const more = $("next-more");
  more.hidden = todos.length <= NEXT_SHOWN;
  more.textContent = showAllNext ? "Show fewer" : `Show all ${todos.length}`;
}

function nextItem(todo, index) {
  const goal = goalById(todo.goal_id);
  const late = todo.due && todo.due < today();
  const meta = [
    goal?.area,
    todo.due && (late ? "was due " : "by ") + formatDate(todo.due),
  ].filter(Boolean).join(" · ");
  const menuId = `menu-${todo.id}`;
  const item = el("li", { class: "next-item" },
    el("input", {
      type: "checkbox",
      "aria-label": `Done: ${todo.text}`,
      onchange: (e) => {
        item.classList.add("leaving");
        edit("tick", { id: todo.id, done: e.target.checked });
      },
    }),
    el("div", { class: "next-body" },
      el("span", { class: "next-text" }, todo.text),
      meta && el("span", { class: "meta" + (late ? " late" : "") }, meta),
    ),
    todo.time && el("span", { class: "time" }, todo.time),
    el("button", {
      type: "button",
      class: "icon-btn",
      "aria-label": `More for ${todo.text}`,
      "aria-expanded": "false",
      "aria-controls": menuId,
      onclick: (e) => {
        const open = item.classList.toggle("menu-open");
        e.currentTarget.setAttribute("aria-expanded", open);
      },
    }, "⋯"),
    el("div", { class: "item-menu", id: menuId },
      index > 0 && el("button", { type: "button", class: "btn ghost small", onclick: () => edit("top", { id: todo.id }) }, "Move to top"),
      el("button", { type: "button", class: "btn ghost small", onclick: () => askAbout(`Help me with "${todo.text}". `) }, "Ask the coach"),
      el("button", { type: "button", class: "btn ghost small danger", onclick: () => edit("delete", { id: todo.id }) }, "Delete"),
    ),
  );
  return item;
}

$("next-more").addEventListener("click", () => {
  showAllNext = !showAllNext;
  renderNext();
});

// This week: each weekly goal (like 5 workouts) as a count, a dot per day, and
// the streak, with a button to log one without typing.
function renderWeek() {
  const weekly = state.goals.filter((g) => g.kind === "weekly" && !g.done);
  $("week-card").hidden = !weekly.length;
  const box = $("week");
  box.replaceChildren();
  const start = weekStart(today());
  const todayIndex = daysBetween(start, today());
  for (const goal of weekly) {
    const s = weeklyStats(goal, state.log, today());
    const unit = goal.unit || "times";
    const one = unit.replace(/s$/, "");
    box.append(el("div", { class: "week-goal" },
      el("div", { class: "week-top" },
        el("div", {},
          el("div", { class: "week-count" }, el("strong", {}, String(s.count)), ` of ${s.target} ${unit}`),
          el("div", { class: "meta" }, goal.title),
        ),
        el("div", { class: "streak" + (s.streak ? " on" : "") },
          s.streak ? `${plural(s.streak, "week")} in a row` : s.count >= s.target ? "Hit it!" : `${s.target - s.count} to go`),
      ),
      el("div", { class: "dots", role: "img", "aria-label": `${s.count} of ${s.target} this week` },
        s.days.map((n, i) => el("span", {
          class: "dot" + (n ? " hit" : "") + (i === todayIndex ? " today" : ""),
          title: new Date(addDays(start, i) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" }),
        }, "MTWTFSS"[i]))),
      el("div", { class: "week-actions" },
        el("button", {
          type: "button",
          class: "btn small",
          onclick: () => edit("log", { goal_id: goal.id, text: one.charAt(0).toUpperCase() + one.slice(1) }),
        }, `+ Log a ${one}`),
        el("span", { class: "muted small" }, "or tell the coach \"did push day\""),
      ),
    ));
  }
}

// Goal cards: where it stands, the date, the next step, the last two Log
// lines, and "Talk it through".
function renderGoals() {
  const grid = $("goal-grid");
  grid.replaceChildren();
  if (!state.goals.length) {
    grid.append(el("p", { class: "empty card" }, "No goals yet. Tell the coach something you want to get done."));
    return;
  }
  for (const goal of state.goals) grid.append(goalCard(goal));
}

function goalCard(goal) {
  const next = state.todos.find((t) => t.goal_id === goal.id);
  const recent = state.log.filter((l) => l.goal_id === goal.id).slice(0, 2);
  return el("article", { class: "goal-card card" + (goal.done ? " done" : "") },
    el("div", { class: "goal-area" }, goal.area || "Goal"),
    el("h3", { class: "goal-title" }, goal.done ? "✓ " : "", goal.title),
    goalProgress(goal),
    !goal.done && (next || goal.kind !== "weekly") && el("div", { class: "goal-next" },
      el("span", { class: "label" }, "Next"),
      next
        ? el("span", {}, next.text, next.time && el("span", { class: "muted" }, ` · ${next.time}`))
        : el("span", { class: "muted" }, "No next step yet")),
    recent.length > 0 && el("ul", { class: "goal-log" },
      recent.map((l) => el("li", {}, el("span", { class: "muted" }, dayLabel(l.date) + " · "), l.text))),
    !goal.done && el("button", {
      type: "button",
      class: "btn ghost small talk",
      onclick: () => askAbout(`Let's talk about my goal "${goal.title}". `),
    }, "Talk it through"),
  );
}

function goalProgress(goal) {
  const due = goal.due && !goal.done && el("span", {}, dueText(goal.due));
  if (goal.done) return el("div", { class: "goal-status done-text" }, "Done");

  if (goal.kind === "weekly") {
    const s = weeklyStats(goal, state.log, today());
    return el("div", { class: "goal-status" },
      el("span", {}, `${s.count} of ${s.target} this week`),
      s.streak > 0 && el("span", {}, `${plural(s.streak, "week")} in a row`));
  }

  if (goal.kind === "steps" && Array.isArray(goal.steps) && goal.steps.length) {
    const done = Math.min(goal.steps.length, Math.max(0, Math.round(goal.progress || 0)));
    return el("div", {},
      el("div", { class: "goal-status" }, el("span", {}, `Step ${Math.min(done + 1, goal.steps.length)} of ${goal.steps.length}`), due),
      el("ol", { class: "steps" }, goal.steps.map((step, i) =>
        el("li", { class: i < done ? "done" : i === done ? "current" : null, "aria-current": i === done ? "step" : null }, step))));
  }

  if (goal.target) {
    const pct = Math.min(100, Math.round(((goal.progress || 0) / goal.target) * 100));
    return el("div", {},
      el("div", { class: "goal-status" }, el("span", {}, `${goal.progress || 0} of ${goal.target}${goal.unit ? " " + goal.unit : ""}`), due),
      el("div", { class: "bar", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": goal.title },
        el("span", { style: `width: ${pct}%` })));
  }
  return due ? el("div", { class: "goal-status" }, due) : null;
}

function dueText(due) {
  const days = daysBetween(today(), due);
  if (days < 0) return `was due ${formatDate(due)}`;
  if (days === 0) return "due today";
  if (days <= 14) return `due in ${plural(days, "day")}`;
  return `by ${formatDate(due)}`;
}

// The Log: everything done, newest first, grouped by day.
function renderLog() {
  const box = $("log-list");
  box.replaceChildren();
  if (!state.log.length) {
    box.append(el("p", { class: "empty" }, "Nothing logged yet. Tick something in Next up, or tell the coach what you did."));
    return;
  }
  let day = null, list = null;
  for (const entry of state.log) {
    if (entry.date !== day) {
      day = entry.date;
      list = el("ul", {});
      box.append(el("h3", { class: "log-day" }, dayLabel(day)), list);
    }
    const goal = goalById(entry.goal_id);
    const fromTodo = entry.source === "todo";
    list.append(el("li", {},
      el("span", { class: "log-text" }, entry.text, goal && el("span", { class: "meta" }, goal.title)),
      el("button", {
        type: "button",
        class: "icon-btn",
        title: fromTodo ? "Put back in Next up" : "Remove from Log",
        "aria-label": fromTodo ? `Put "${entry.text}" back in Next up` : `Remove "${entry.text}" from the Log`,
        onclick: () => (fromTodo ? edit("tick", { id: entry.id, done: false }) : edit("unlog", { id: entry.id })),
      }, fromTodo ? "↺" : "✕"),
    ));
  }
}

// Tried: things tried, marked done, keeping or ruled out, with why.
function renderTried() {
  const list = $("tried-list");
  list.replaceChildren();
  if (!state.tried.length) {
    list.append(el("li", { class: "empty" }, "Nothing yet. Tell the coach about something you tried, like \"I tried robotics club but it's not for me.\""));
    return;
  }
  for (const item of state.tried) {
    list.append(el("li", {},
      el("div", { class: "tried-top" },
        el("span", { class: "tried-name" }, item.name),
        el("span", { class: "pill " + item.status.replace(" ", "-") }, item.status)),
      item.why && el("p", { class: "muted small" }, item.why),
    ));
  }
}

function selectTab(which) {
  $("tab-log").setAttribute("aria-selected", which === "log");
  $("tab-tried").setAttribute("aria-selected", which === "tried");
  $("log-list").hidden = which !== "log";
  $("tried-list").hidden = which !== "tried";
}
$("tab-log").addEventListener("click", () => selectTab("log"));
$("tab-tried").addEventListener("click", () => selectTab("tried"));

// "Start from my plan": adds plan.json (the plan from the planning chat).
$("start-plan").addEventListener("click", async () => {
  const button = $("start-plan");
  button.disabled = true;
  $("start-error").hidden = true;
  const plan = await fetch("plan.json").then((r) => r.json()).catch(() => null);
  const result = plan ? await edit("import", { plan }) : null;
  button.disabled = false;
  if (!result) {
    $("start-error").textContent = "Couldn't add the plan. Try again in a moment.";
    $("start-error").hidden = false;
  }
});
$("start-chat").addEventListener("click", () => askAbout(""));

// ---------- Chat ----------

// On a phone the chat is a sheet that opens over the dashboard.
const isPhone = () => matchMedia("(max-width: 860px)").matches;

function openChat() {
  if (!isPhone()) return;
  $("chat").classList.add("open");
  document.body.classList.add("chat-open");
  const box = $("chat-messages");
  box.scrollTop = box.scrollHeight;
}
function closeChat() {
  $("chat").classList.remove("open");
  document.body.classList.remove("chat-open");
}
$("chat-bar").addEventListener("click", () => {
  openChat();
  $("chat-form").text.focus();
});
$("chat-close").addEventListener("click", closeChat);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("chat").classList.contains("open")) closeChat();
});

// "Talk it through" and friends: open the chat with the start of a message.
function askAbout(text) {
  openChat();
  const input = $("chat-form").text;
  input.value = text;
  input.focus();
  input.setSelectionRange(text.length, text.length);
}

// The Undo button under a reply's changes puts everything back the way it was
// before that reply.
async function undoReply(turn, button) {
  button.disabled = true;
  const { ok, status, data } = await call("undo", { method: "POST", body: { turn } });
  if (status === 401) return showAuth();
  if (!ok) {
    button.disabled = false;
    return addMessage("assistant", data.error || "Couldn't undo that. Try again.").classList.add("error");
  }
  setLists(data);
  button.replaceWith(el("span", { class: "undone" }, "Undone"));
}

function addMessage(role, text, changes = [], turn = null) {
  const box = $("chat-messages");
  box.querySelector(".chat-empty")?.remove();
  const undoButton = turn && el("button", { type: "button", class: "btn ghost small undo" }, "Undo");
  undoButton?.addEventListener("click", () => undoReply(turn, undoButton));
  const node = el("div", { class: "msg " + (role === "user" ? "me" : "ai") }, text,
    changes.length > 0 && el("div", { class: "changes" },
      el("ul", {}, changes.map((c) => el("li", {}, c))),
      undoButton));
  box.append(node);
  box.scrollTop = box.scrollHeight;
  return node;
}

const STARTERS = ["Did push day", "What should I do next?", "Move the recipe to the top", "I tried a new club"];

function renderChat(messages) {
  const box = $("chat-messages");
  box.replaceChildren();
  if (!messages.length) {
    box.append(el("div", { class: "chat-empty" },
      el("p", {}, `Hi ${state.user.name}! Tell me what you did or what you're working on, and I'll keep your dashboard up to date.`),
      el("div", { class: "chips" }, STARTERS.map((text) =>
        el("button", { type: "button", class: "chip", onclick: () => askAbout(text) }, text))),
    ));
  }
  for (const m of messages) addMessage(m.role, m.text);
}

let sending = false;
$("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const text = form.text.value.trim();
  if (!text || sending) return;

  sending = true;
  form.text.value = "";
  form.send.disabled = true;
  addMessage("user", text);
  const thinking = addMessage("assistant", "Thinking…");
  thinking.classList.add("typing");

  const { ok, status, data } = await call("chat", { method: "POST", body: { text, today: today() } });
  thinking.remove();
  sending = false;
  form.send.disabled = false;
  form.text.focus();

  if (status === 401) return showAuth();
  setLists(data);
  if (ok) addMessage("assistant", data.reply, data.changes || [], data.undo);
  else addMessage("assistant", data.error || "Something went wrong. Try again.", data.changes || [], data.undo).classList.add("error");
});

// ---------- start ----------

(async function start() {
  if (!savedToken()) return showAuth();
  const { ok, status, data } = await call("me");
  if (ok) return showApp(data);
  if (status === 401) saveToken("");
  showAuth();
  if (status !== 401) showAuthError(data.error || "Couldn't load your goals. Try logging in again.");
})();
