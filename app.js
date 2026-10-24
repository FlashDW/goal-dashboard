// Goals dashboard v1: reads data.json and draws the whole page from it.
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

// ---------- Talk it through (scripted chat) ----------

let chatRun = 0; // bumps each time the chat opens, so an old playback stops

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function openChat(fromGoal) {
  const dialog = document.getElementById("chat");
  const messages = document.getElementById("chat-messages");
  const chat = data.sampleChat;
  const chatGoal = goalById(chat.goal);
  const run = ++chatRun;

  document.getElementById("chat-title").textContent = "Talk it through: " + fromGoal.area;
  document.getElementById("chat-note").textContent =
    `Scripted sample about your ${chatGoal.name} goal. A real AI comes in a later version.`;
  messages.replaceChildren();
  if (!dialog.open) dialog.showModal();

  for (const msg of chat.messages) {
    await wait(msg.from === "ai" ? 900 : 500);
    if (run !== chatRun || !dialog.open) return;

    messages.append(el("div", { class: "msg " + (msg.from === "ai" ? "ai" : "me") }, el("p", {}, msg.text)));
    messages.scrollTop = messages.scrollHeight;

    if (msg.suggestion) {
      await suggestionBox(msg.suggestion, chatGoal);
      if (run !== chatRun || !dialog.open) return;
    }
  }

  await wait(400);
  if (run === chatRun && dialog.open) {
    messages.append(el("p", { class: "chat-end" }, "End of the sample conversation."));
    messages.scrollTop = messages.scrollHeight;
  }
}

document.getElementById("chat-close").addEventListener("click", () => {
  chatRun++;
  document.getElementById("chat").close();
});

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
