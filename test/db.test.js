// Tests against a real Postgres database: the AI's tools, undo, and that one
// person can never touch another's goals. They run on GitHub automatically.
// On your computer they're skipped unless TEST_DATABASE_URL points at an empty
// throwaway database (never the real one: the tests wipe it).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : "set TEST_DATABASE_URL to run database tests" };

let sql, ensureSchema, loadState, runTool, undoTurn;
let asher, friend;

before(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  ({ sql, ensureSchema, loadState } = await import("../lib/db.js"));
  ({ runTool, undoTurn } = await import("../lib/chat.js"));
  await sql.unsafe("drop schema public cascade; create schema public;");
  await ensureSchema();
  const make = async (name) =>
    Number((await sql`insert into users (name, name_key, password_hash) values (${name}, ${name}, 'x') returning id`)[0].id);
  asher = await make("asher");
  friend = await make("friend");
});

after(async () => {
  await sql?.end();
});

test("migrations run once and are safe to run again", opts, async () => {
  const before = await sql`select version from schema_migrations order by version`;
  const { MIGRATIONS } = await import("../lib/db.js");
  assert.equal(before.length, MIGRATIONS.length);
  await ensureSchema();
  const again = await sql`select version from schema_migrations`;
  assert.equal(again.length, MIGRATIONS.length);
});

test("undo reverses a whole reply's adds, edits and deletes", opts, async () => {
  const setup = "setup-turn";
  await runTool(asher, "add_goal", { title: "Finish CS50 AI", target: 7, unit: "weeks" }, setup);
  const [goal] = (await loadState(asher)).goals;
  await runTool(asher, "add_todo", { text: "Watch week 3", goal_id: goal.id }, setup);
  const [todo] = (await loadState(asher)).todos;
  const snapshot = await loadState(asher);

  const turn = "turn-1";
  const r1 = await runTool(asher, "update_goal", { goal_id: goal.id, progress: 3, title: "CS50 AI" }, turn);
  const r2 = await runTool(asher, "update_todo", { todo_id: todo.id, done: true }, turn);
  const r3 = await runTool(asher, "add_todo", { text: "Start week 4" }, turn);
  const r4 = await runTool(asher, "delete_goal", { goal_id: goal.id }, turn);
  assert.deepEqual([r1, r2, r3, r4].map((r) => r.error ?? false), [false, false, false, false]);
  assert.equal((await loadState(asher)).goals.length, 0);

  const undone = await undoTurn(asher, turn);
  assert.equal(undone.length, 4);
  assert.deepEqual(await loadState(asher), snapshot);

  assert.deepEqual(await undoTurn(asher, turn), [], "undoing twice does nothing");
});

test("undo brings back a deleted todo", opts, async () => {
  await runTool(asher, "add_todo", { text: "Get groceries", due: "2026-10-30" }, "t2a");
  const todo = (await loadState(asher)).todos.find((t) => t.text === "Get groceries");
  await runTool(asher, "delete_todo", { todo_id: todo.id }, "t2b");
  await undoTurn(asher, "t2b");
  assert.ok((await loadState(asher)).todos.some((t) => t.id === todo.id && t.due === "2026-10-30"));
});

test("one person's AI can't see or change another person's goals", opts, async () => {
  await runTool(asher, "add_goal", { title: "Private goal" }, "t3");
  const mine = (await loadState(asher)).goals.find((g) => g.title === "Private goal");

  const edit = await runTool(friend, "update_goal", { goal_id: mine.id, title: "Hacked" }, "t4");
  const del = await runTool(friend, "delete_goal", { goal_id: mine.id }, "t4");
  const link = await runTool(friend, "add_todo", { text: "x", goal_id: mine.id }, "t4");
  assert.equal(edit.error, true);
  assert.equal(del.error, true);
  assert.equal(link.error, true);
  const line = await runTool(asher, "add_log", { text: "Private log" }, "t3");
  const item = await runTool(asher, "add_tried", { name: "Private club", status: "keeping" }, "t3");
  const todo = await runTool(asher, "add_todo", { text: "Private task" }, "t3");
  assert.equal((await runTool(friend, "delete_log", { log_id: line.id }, "t4")).error, true);
  assert.equal((await runTool(friend, "update_tried", { tried_id: item.id, status: "done" }, "t4")).error, true);
  assert.equal((await runTool(friend, "update_todo", { todo_id: todo.id, place: "top" }, "t4")).error, true);
  const mineToo = await runTool(friend, "add_todo", { text: "Friend task" }, "t4");
  assert.equal((await runTool(friend, "update_todo", { todo_id: mineToo.id, before_todo_id: todo.id }, "t4")).error, true);
  await undoTurn(friend, "t4");
  assert.deepEqual(await undoTurn(friend, "t3"), [], "can't undo someone else's reply");
  assert.ok((await loadState(asher)).goals.some((g) => g.id === mine.id && g.title === "Private goal"));
  const friendState = await loadState(friend);
  assert.deepEqual([friendState.goals, friendState.todos, friendState.log, friendState.tried], [[], [], [], []]);
});

test("Next up keeps the person's order: add at the top, move above another", opts, async () => {
  const add = async (text, extra = {}) => (await runTool(asher, "add_todo", { text, ...extra }, "order")).id;
  const a = await add("A");
  const b = await add("B");
  const c = await add("C", { place: "top", time: "10 min" });
  const order = async () => (await loadState(asher)).todos.filter((t) => [a, b, c].includes(t.id)).map((t) => t.text);
  assert.deepEqual(await order(), ["C", "A", "B"]);
  assert.equal((await loadState(asher)).todos.find((t) => t.id === c).time, "10 min");

  await runTool(asher, "update_todo", { todo_id: b, before_todo_id: a }, "move");
  assert.deepEqual(await order(), ["C", "B", "A"]);
  await undoTurn(asher, "move");
  assert.deepEqual(await order(), ["C", "A", "B"]);
});

test("ticking a task moves it to the Log with the person's date, and undo puts it back", opts, async () => {
  const id = (await runTool(asher, "add_todo", { text: "Pick a recipe" }, "tick-setup")).id;
  await runTool(asher, "update_todo", { todo_id: id, done: true }, "tick", "2026-10-24");
  let state = await loadState(asher);
  assert.ok(!state.todos.some((t) => t.id === id));
  assert.deepEqual(
    state.log.find((l) => l.source === "todo" && l.id === id),
    { source: "todo", id, goal_id: null, text: "Pick a recipe", date: "2026-10-24" },
  );
  await undoTurn(asher, "tick");
  state = await loadState(asher);
  assert.ok(state.todos.some((t) => t.id === id));
  assert.ok(!state.log.some((l) => l.source === "todo" && l.id === id));
});

test("log lines, weekly goals, steps goals and the Tried list, all undoable", opts, async () => {
  const turn = "dashboard";
  const fit = await runTool(asher, "add_goal", { title: "Work out", kind: "weekly", target: 5, unit: "workouts" }, turn);
  const job = await runTool(asher, "add_goal", { title: "Barista", kind: "steps", steps: ["Permit", "Apply", "Start"] }, turn);
  const line = await runTool(asher, "add_log", { text: "Push day", goal_id: fit.id }, turn, "2026-10-24");
  const tried = await runTool(asher, "add_tried", { name: "Steel Dragons", status: "ruled out", why: "Too far" }, turn, "2026-10-24");
  assert.deepEqual([fit, job, line, tried].map((r) => r.error ?? false), [false, false, false, false]);

  let state = await loadState(asher);
  assert.equal(state.goals.find((g) => g.id === fit.id).kind, "weekly");
  assert.deepEqual(state.goals.find((g) => g.id === job.id).steps, ["Permit", "Apply", "Start"]);
  assert.deepEqual(state.log[0], { source: "log", id: line.id, goal_id: fit.id, text: "Push day", date: "2026-10-24" });
  assert.deepEqual(state.tried.find((t) => t.id === tried.id), { id: tried.id, name: "Steel Dragons", status: "ruled out", why: "Too far", date: "2026-10-24" });

  assert.equal((await runTool(asher, "add_tried", { name: "x", status: "maybe" }, turn)).error, true);
  assert.equal((await runTool(asher, "add_goal", { title: "x", kind: "daily" }, turn)).error, true);

  // Editing steps and deleting a goal with log lines both come back on undo.
  const snapshot = await loadState(asher);
  await runTool(asher, "update_goal", { goal_id: job.id, steps: ["Permit", "Start"], progress: 1 }, "edit");
  await runTool(asher, "update_tried", { tried_id: tried.id, status: "keeping" }, "edit");
  await runTool(asher, "delete_goal", { goal_id: fit.id }, "edit");
  await runTool(asher, "delete_log", { log_id: line.id }, "edit");
  await undoTurn(asher, "edit");
  assert.deepEqual(await loadState(asher), snapshot);

  await undoTurn(asher, turn);
  state = await loadState(asher);
  assert.ok(!state.goals.some((g) => [fit.id, job.id].includes(g.id)));
  assert.ok(!state.log.some((l) => l.source === "log" && l.id === line.id));
  assert.ok(!state.tried.some((t) => t.id === tried.id));
});

test("Start from my plan adds plan.json in one undoable go", opts, async () => {
  const { readFile } = await import("node:fs/promises");
  const { importPlan } = await import("../lib/plan.js");
  const plan = JSON.parse(await readFile(new URL("../plan.json", import.meta.url), "utf8"));
  const result = await importPlan(friend, plan, "plan", "2026-10-24");
  assert.match(result.change, /^Added your plan: 6 goals and \d+ tasks$/);
  const state = await loadState(friend);
  assert.equal(state.goals.length, plan.goals.length);
  assert.deepEqual(state.todos.map((t) => t.text), plan.next.map((t) => t.text), "kept in the plan's order");
  const job = state.goals.find((g) => g.kind === "steps");
  assert.ok(state.todos.some((t) => t.goal_id === job.id), "tasks are linked to their goals");

  const bad = await importPlan(friend, { goals: [{ title: "ok" }, { title: "" }] }, "bad-plan", "2026-10-24");
  assert.match(bad.error, /couldn't be added/);
  assert.equal((await loadState(friend)).goals.length, plan.goals.length, "a bad plan adds nothing");

  await undoTurn(friend, "plan");
  assert.equal((await loadState(friend)).goals.length, 0);
});
