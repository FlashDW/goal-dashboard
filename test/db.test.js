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
  assert.deepEqual(await undoTurn(friend, "t3"), [], "can't undo someone else's reply");
  assert.ok((await loadState(asher)).goals.some((g) => g.id === mine.id && g.title === "Private goal"));
  assert.equal((await loadState(friend)).goals.length, 0);
});
