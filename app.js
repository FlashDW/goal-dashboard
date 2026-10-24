// My goals: log in, then chat with the AI, which keeps your goals and todos in
// the database. Everything you see comes from the server (the api/ folder on
// Vercel), so it's still there when you reload or switch devices.

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

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- state ----------

let state = { user: null, goals: [], todos: [] };

function setLists(data) {
  if (Array.isArray(data.goals)) state.goals = data.goals;
  if (Array.isArray(data.todos)) state.todos = data.todos;
  renderLists();
}

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
  state = { user: null, goals: [], todos: [] };
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
  $("chat-form").text.focus();
}

// ---------- Todos and Goals lists ----------

async function changeTodo(todo, change) {
  const { ok, status, data } = await call("todo", { method: "POST", body: { id: todo.id, ...change } });
  if (status === 401) return showAuth();
  if (ok) setLists(data);
}

function renderTodos() {
  const list = $("todo-list");
  list.replaceChildren();
  if (!state.todos.length) {
    list.append(el("li", { class: "empty" }, "Nothing yet. Ask the chat to add a todo."));
    return;
  }
  const goalName = (id) => state.goals.find((g) => g.id === id)?.title;
  for (const todo of state.todos) {
    const late = !todo.done && todo.due && todo.due < today();
    list.append(el("li", { class: todo.done ? "done" : null },
      el("input", {
        type: "checkbox",
        checked: todo.done,
        "aria-label": `Done: ${todo.text}`,
        onchange: (e) => changeTodo(todo, { done: e.target.checked }),
      }),
      el("div", { class: "todo-body" },
        el("span", { class: "todo-text" }, todo.text),
        (todo.due || todo.goal_id) && el("span", { class: "meta" + (late ? " late" : "") },
          [todo.due && formatDate(todo.due), goalName(todo.goal_id)].filter(Boolean).join(" · ")),
      ),
      el("button", {
        type: "button",
        class: "icon-btn",
        "aria-label": `Delete ${todo.text}`,
        onclick: () => changeTodo(todo, { delete: true }),
      }, "✕"),
    ));
  }
}

function renderGoals() {
  const list = $("goal-list");
  list.replaceChildren();
  if (!state.goals.length) {
    list.append(el("li", { class: "empty" }, "No goals yet. Tell the chat something you want to get done."));
    return;
  }
  for (const goal of state.goals) {
    const pct = goal.target ? Math.min(100, Math.round((goal.progress / goal.target) * 100)) : null;
    const meta = [
      goal.area,
      goal.due && "by " + formatDate(goal.due),
      goal.target && `${goal.progress} of ${goal.target}${goal.unit ? " " + goal.unit : ""}`,
    ].filter(Boolean).join(" · ");
    list.append(el("li", { class: goal.done ? "done" : null },
      el("div", { class: "goal-title" }, goal.done ? "✓ " : "", goal.title),
      meta && el("div", { class: "meta" }, meta),
      pct != null && el("div", { class: "bar", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": goal.title },
        el("span", { style: `width: ${pct}%` })),
    ));
  }
}

function renderLists() {
  renderTodos();
  renderGoals();
}

// ---------- Chat ----------

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

function renderChat(messages) {
  const box = $("chat-messages");
  box.replaceChildren();
  if (!messages.length) {
    box.append(el("div", { class: "chat-empty" },
      el("p", {}, `Hi ${state.user.name}! Tell me what you're working on.`),
      el("p", { class: "muted" }, "You can say things like \"add a todo for getting groceries\", \"I want to run a 5K by June\", or \"I finished my essay\"."),
    ));
  }
  for (const m of messages) addMessage(m.role, m.text);
}

$("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const text = form.text.value.trim();
  if (!text) return;

  form.text.value = "";
  form.send.disabled = true;
  addMessage("user", text);
  const thinking = addMessage("assistant", "…");
  thinking.classList.add("typing");

  const { ok, status, data } = await call("chat", { method: "POST", body: { text, today: today() } });
  thinking.remove();
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
