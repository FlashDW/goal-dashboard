// The AI side of the chat: the tools Claude can use to change someone's goals
// and todos, and the code that runs those tools against the database.
//
// Every tool runs with the signed-in person's user_id, which comes from their
// login, never from Claude. So even a confused or tricked AI can only touch the
// goals and todos of the person who is chatting.

import { sql } from "./db.js";

const MAX_TEXT = 300;
export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// The person's own date, sent by the page, so "tomorrow" means tomorrow where
// they are (the server runs on UTC, which is already tomorrow by 8pm in
// Pittsburgh). Anything odd falls back to the server's date.
export function localToday(given, now = new Date()) {
  const server = now.toISOString().slice(0, 10);
  if (!isDate(given)) return server;
  const days = Math.abs(Date.parse(given) - Date.parse(server)) / 86400000;
  return days <= 1 ? given : server;
}

export async function recentMessages(userId, limit = 40) {
  const rows = await sql`
    select role, text from (
      select id, role, text from messages where user_id = ${userId}
      order by id desc limit ${limit}
    ) recent order by id`;
  return rows.map((r) => ({ role: r.role, text: r.text }));
}

const goalFields = {
  title: { type: "string", description: "Short name of the goal, like \"Run a 5K\"." },
  area: { type: "string", description: "Life area it belongs to, like \"Fitness\", \"School\" or \"Job\". Reuse an existing area name when one fits." },
  due: { type: ["string", "null"], description: "Target date as YYYY-MM-DD, or null for none." },
  target: { type: ["number", "null"], description: "A number to reach, like 3 projects or 20 phrases. null if the goal isn't counted." },
  unit: { type: ["string", "null"], description: "What the target counts, like \"projects\"." },
  notes: { type: ["string", "null"], description: "Anything else worth remembering about the goal." },
};

export const TOOLS = [
  {
    name: "add_goal",
    description: "Create a new goal. Use for bigger things someone is working toward over weeks or months.",
    input_schema: { type: "object", properties: goalFields, required: ["title"], additionalProperties: false },
  },
  {
    name: "update_goal",
    description: "Change a goal: rename it, change its date or target, record progress, or mark it done. Only include fields that change.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "integer" },
        ...goalFields,
        progress: { type: "number", description: "How far along toward the target, like 2 (of 3)." },
        done: { type: "boolean" },
      },
      required: ["goal_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_goal",
    description: "Delete a goal for good. Its todos stay, unlinked. Only when the person clearly asks to remove it.",
    input_schema: { type: "object", properties: { goal_id: { type: "integer" } }, required: ["goal_id"], additionalProperties: false },
  },
  {
    name: "add_todo",
    description: "Add a todo: a single concrete task, like \"Get groceries\".",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The task as a short action." },
        due: { type: ["string", "null"], description: "Date as YYYY-MM-DD, or null." },
        goal_id: { type: ["integer", "null"], description: "The goal this task helps with, if any." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "update_todo",
    description: "Change a todo: tick it off (done: true), reopen it, reword it, change its date or goal. Only include fields that change.",
    input_schema: {
      type: "object",
      properties: {
        todo_id: { type: "integer" },
        text: { type: "string" },
        due: { type: ["string", "null"] },
        goal_id: { type: ["integer", "null"] },
        done: { type: "boolean" },
      },
      required: ["todo_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_todo",
    description: "Delete a todo for good. Use update_todo with done: true when it was finished instead.",
    input_schema: { type: "object", properties: { todo_id: { type: "integer" } }, required: ["todo_id"], additionalProperties: false },
  },
];

export class ToolError extends Error {}

function text(value, field, { required = false } = {}) {
  if (value == null && !required) return null;
  if (typeof value !== "string" || !value.trim()) throw new ToolError(`${field} must be some text.`);
  return value.trim().slice(0, MAX_TEXT);
}
function date(value) {
  if (value == null || value === "") return null;
  if (!isDate(value)) throw new ToolError("Dates must look like 2027-06-01.");
  return value;
}
function num(value, field) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ToolError(`${field} must be a number.`);
  return value;
}
async function ownGoal(userId, goalId) {
  if (goalId == null) return null;
  const [row] = await sql`select * from goals where id = ${goalId} and user_id = ${userId}`;
  if (!row) throw new ToolError(`There's no goal with id ${goalId}.`);
  return row;
}

// Copies only the fields Claude sent, after checking each one.
export function goalChanges(input) {
  const out = {};
  if ("title" in input) out.title = text(input.title, "title", { required: true });
  if ("area" in input) out.area = text(input.area, "area");
  if ("due" in input) out.due = date(input.due);
  if ("target" in input) out.target = num(input.target, "target");
  if ("unit" in input) out.unit = text(input.unit, "unit");
  if ("notes" in input) out.notes = text(input.notes, "notes");
  if ("progress" in input) out.progress = num(input.progress, "progress") ?? 0;
  if ("done" in input) out.done = Boolean(input.done);
  return out;
}

// Every change is written to the changes table with what it replaced, tagged
// with the chat reply ("turn") it belongs to, so undoTurn can reverse it.
async function record(userId, turn, kind, action, rowId, before, label) {
  await sql`
    insert into changes (user_id, turn, kind, action, row_id, before, label)
    values (${userId}, ${turn}, ${kind}, ${action}, ${rowId}, ${before == null ? null : sql.json(before)}, ${label})`;
  return label;
}

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));

// Runs one tool. Returns { result, change } where result goes back to Claude
// and change is a short line the page shows, like "Added todo: Get groceries".
export async function runTool(userId, name, input = {}, turn = "none") {
  const log = (kind, action, rowId, before, label) => record(userId, turn, kind, action, rowId, before, label);
  try {
    switch (name) {
      case "add_goal": {
        const g = goalChanges(input);
        if (!g.title) throw new ToolError("A goal needs a title.");
        const [row] = await sql`
          insert into goals (user_id, title, area, due, target, unit, notes)
          values (${userId}, ${g.title}, ${g.area ?? null}, ${g.due ?? null}, ${g.target ?? null}, ${g.unit ?? null}, ${g.notes ?? null})
          returning id`;
        return { result: `Added goal ${row.id}.`, change: await log("goal", "add", row.id, null, `Added goal: ${g.title}`) };
      }
      case "update_goal": {
        const goal = await ownGoal(userId, input.goal_id);
        if (!goal) throw new ToolError("Which goal? goal_id is missing.");
        const g = goalChanges(input);
        if (!Object.keys(g).length) throw new ToolError("Nothing to change.");
        const before = pick(goal, Object.keys(g));
        await sql`update goals set ${sql(g)} where id = ${goal.id} and user_id = ${userId}`;
        return { result: "Updated.", change: await log("goal", "update", goal.id, before, `Updated goal: ${g.title ?? goal.title}`) };
      }
      case "delete_goal": {
        const goal = await ownGoal(userId, input.goal_id);
        if (!goal) throw new ToolError("Which goal? goal_id is missing.");
        // Remember which todos pointed at it, so an undo can link them back.
        const linked = await sql`select id from todos where goal_id = ${goal.id} and user_id = ${userId}`;
        await sql`delete from goals where id = ${goal.id} and user_id = ${userId}`;
        const before = { row: goal, todo_ids: linked.map((t) => t.id) };
        return { result: "Deleted.", change: await log("goal", "delete", goal.id, before, `Deleted goal: ${goal.title}`) };
      }
      case "add_todo": {
        const t = text(input.text, "text", { required: true });
        const goal = await ownGoal(userId, input.goal_id ?? null);
        const [row] = await sql`
          insert into todos (user_id, goal_id, text, due)
          values (${userId}, ${goal?.id ?? null}, ${t}, ${date(input.due)})
          returning id`;
        return { result: `Added todo ${row.id}.`, change: await log("todo", "add", row.id, null, `Added todo: ${t}`) };
      }
      case "update_todo": {
        const [todo] = await sql`select * from todos where id = ${input.todo_id ?? null} and user_id = ${userId}`;
        if (!todo) throw new ToolError(`There's no todo with id ${input.todo_id}.`);
        const t = {};
        if ("text" in input) t.text = text(input.text, "text", { required: true });
        if ("due" in input) t.due = date(input.due);
        if ("goal_id" in input) t.goal_id = (await ownGoal(userId, input.goal_id))?.id ?? null;
        if ("done" in input) {
          t.done = Boolean(input.done);
          t.done_at = t.done ? new Date() : null;
        }
        if (!Object.keys(t).length) throw new ToolError("Nothing to change.");
        const before = pick(todo, Object.keys(t));
        await sql`update todos set ${sql(t)} where id = ${todo.id} and user_id = ${userId}`;
        const label = t.text ?? todo.text;
        return { result: "Updated.", change: await log("todo", "update", todo.id, before, t.done === true ? `Done: ${label}` : `Updated todo: ${label}`) };
      }
      case "delete_todo": {
        const [todo] = await sql`
          delete from todos where id = ${input.todo_id ?? null} and user_id = ${userId} returning *`;
        if (!todo) throw new ToolError(`There's no todo with id ${input.todo_id}.`);
        return { result: "Deleted.", change: await log("todo", "delete", todo.id, { row: todo }, `Deleted todo: ${todo.text}`) };
      }
      default:
        throw new ToolError(`Unknown tool ${name}.`);
    }
  } catch (err) {
    if (err instanceof ToolError) return { result: err.message, error: true };
    throw err;
  }
}

// Undo every change from one chat reply, newest first, so the goals and todos
// go back to how they were before that reply. Only the signed-in person's own
// changes can be undone. Returns the lines that were undone.
export async function undoTurn(userId, turn) {
  return sql.begin(async (tx) => {
    const rows = await tx`
      select id, kind, action, row_id, before, label from changes
      where user_id = ${userId} and turn = ${turn} and not undone
      order by id desc
      for update`;
    for (const c of rows) {
      const table = tx(c.kind === "goal" ? "goals" : "todos");
      if (c.action === "add") {
        await tx`delete from ${table} where id = ${c.row_id} and user_id = ${userId}`;
      } else if (c.action === "update") {
        await tx`update ${table} set ${tx(c.before)} where id = ${c.row_id} and user_id = ${userId}`;
      } else {
        const row = { ...c.before.row, user_id: userId };
        await tx`insert into ${table} ${tx(row)} on conflict (id) do nothing`;
        if (c.kind === "goal" && c.before.todo_ids?.length) {
          await tx`
            update todos set goal_id = ${c.row_id}
            where user_id = ${userId} and goal_id is null and id in ${tx(c.before.todo_ids)}`;
        }
      }
      await tx`update changes set undone = true where id = ${c.id}`;
    }
    return rows.map((c) => c.label);
  });
}
