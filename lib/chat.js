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
  kind: {
    type: "string",
    enum: ["count", "steps", "weekly"],
    description: "count: reach a number by a date (progress bar). steps: a few steps in order (progress = steps finished). weekly: a habit done some number of times every week, counted from the Log.",
  },
  due: { type: ["string", "null"], description: "Target date as YYYY-MM-DD, or null for none." },
  target: { type: ["number", "null"], description: "count: the number to reach, like 3 projects. weekly: times per week, like 5. null if not counted." },
  unit: { type: ["string", "null"], description: "What the target counts, like \"projects\" or \"workouts\"." },
  steps: { type: ["array", "null"], items: { type: "string" }, description: "steps goals only: the steps in order." },
  notes: { type: ["string", "null"], description: "Anything else worth remembering about the goal." },
};

const place = {
  type: "string",
  enum: ["top", "bottom"],
  description: "Where it goes in Next up. The top is what to do first.",
};

export const TOOLS = [
  {
    name: "add_goal",
    description: "Create a new goal. Use for bigger things someone is working toward over weeks or months.",
    input_schema: { type: "object", properties: goalFields, required: ["title"], additionalProperties: false },
  },
  {
    name: "update_goal",
    description: "Change a goal: rename it, change its date or target, record progress, or mark it done. Only include fields that change. Ask the person before changing a target or date they set.",
    input_schema: {
      type: "object",
      properties: {
        goal_id: { type: "integer" },
        ...goalFields,
        progress: { type: "number", description: "count: how far along, like 2 (of 3). steps: how many steps are finished. Not used for weekly goals." },
        done: { type: "boolean" },
      },
      required: ["goal_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_goal",
    description: "Delete a goal for good. Its todos and log entries stay, unlinked. Only after the person has clearly said yes to removing it.",
    input_schema: { type: "object", properties: { goal_id: { type: "integer" } }, required: ["goal_id"], additionalProperties: false },
  },
  {
    name: "add_todo",
    description: "Add a task to Next up: a single concrete thing to do, like \"Get groceries\". Goes to the bottom unless place says otherwise.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The task as a short action." },
        time: { type: ["string", "null"], description: "About how long it takes, like \"15 min\", \"2 hours\" or \"an afternoon\"." },
        due: { type: ["string", "null"], description: "Date as YYYY-MM-DD, or null." },
        goal_id: { type: ["integer", "null"], description: "The goal this task helps with, if any." },
        place,
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "update_todo",
    description: "Change a Next up task: tick it off (done: true, which moves it to the Log), reopen it, reword it, change its time, date or goal, or move it (place, or before_todo_id to put it just above another task). Only include fields that change.",
    input_schema: {
      type: "object",
      properties: {
        todo_id: { type: "integer" },
        text: { type: "string" },
        time: { type: ["string", "null"] },
        due: { type: ["string", "null"] },
        goal_id: { type: ["integer", "null"] },
        done: { type: "boolean" },
        place,
        before_todo_id: { type: "integer", description: "Move this task to just above that one." },
      },
      required: ["todo_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_todo",
    description: "Delete a task for good. Use update_todo with done: true when it was finished instead.",
    input_schema: { type: "object", properties: { todo_id: { type: "integer" } }, required: ["todo_id"], additionalProperties: false },
  },
  {
    name: "add_log",
    description: "Write one line in the Log about something the person did, like \"Push day\" or \"Watched CS50 AI week 3\". Link it to a goal with goal_id; for weekly goals each log line counts as one time this week.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What they did, as one short line." },
        goal_id: { type: ["integer", "null"] },
        date: { type: ["string", "null"], description: "YYYY-MM-DD when it happened. Leave out for today." },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_log",
    description: "Remove a line from the Log (only entries with source \"log\"; to un-tick a task use update_todo with done: false).",
    input_schema: { type: "object", properties: { log_id: { type: "integer" } }, required: ["log_id"], additionalProperties: false },
  },
  {
    name: "add_tried",
    description: "Add something to the Tried list: an activity, club, place or idea the person tried, with how it went.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "What they tried, like \"Steel Dragons robotics\"." },
        status: { type: "string", enum: ["done", "keeping", "ruled out"], description: "done: finished it. keeping: still doing it. ruled out: not for them." },
        why: { type: ["string", "null"], description: "One line on why or how it went." },
      },
      required: ["name", "status"],
      additionalProperties: false,
    },
  },
  {
    name: "update_tried",
    description: "Change an item on the Tried list. Only include fields that change.",
    input_schema: {
      type: "object",
      properties: {
        tried_id: { type: "integer" },
        name: { type: "string" },
        status: { type: "string", enum: ["done", "keeping", "ruled out"] },
        why: { type: ["string", "null"] },
      },
      required: ["tried_id"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_tried",
    description: "Remove an item from the Tried list.",
    input_schema: { type: "object", properties: { tried_id: { type: "integer" } }, required: ["tried_id"], additionalProperties: false },
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

const KINDS = ["count", "steps", "weekly"];
const STATUSES = ["done", "keeping", "ruled out"];

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new ToolError(`${field} must be one of: ${allowed.join(", ")}.`);
  return value;
}
function steps(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 20) throw new ToolError("steps must be a list of up to 20 steps.");
  return value.map((step) => text(step, "each step", { required: true }));
}

// Copies only the fields Claude sent, after checking each one.
export function goalChanges(input) {
  const out = {};
  if ("title" in input) out.title = text(input.title, "title", { required: true });
  if ("area" in input) out.area = text(input.area, "area");
  if ("kind" in input) out.kind = oneOf(input.kind, KINDS, "kind");
  if ("due" in input) out.due = date(input.due);
  if ("target" in input) out.target = num(input.target, "target");
  if ("unit" in input) out.unit = text(input.unit, "unit");
  if ("steps" in input) out.steps = steps(input.steps);
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

// Next up is ordered by a position number. The top is the smallest. Moving a
// task just above another picks a number halfway between it and the one before.
async function positionFor(userId, where, beforeId = null, skipId = null) {
  if (beforeId != null) {
    const [anchor] = await sql`
      select position from todos where id = ${beforeId} and user_id = ${userId} and not done`;
    if (!anchor) throw new ToolError(`There's no open task with id ${beforeId}.`);
    const [above] = await sql`
      select max(position) as p from todos
      where user_id = ${userId} and not done and position < ${anchor.position} and id <> ${skipId ?? 0}`;
    return above.p == null ? anchor.position - 1 : (above.p + anchor.position) / 2;
  }
  const [row] = await sql`
    select min(position) as lo, max(position) as hi from todos
    where user_id = ${userId} and not done and id <> ${skipId ?? 0}`;
  if (where === "top") return (row.lo ?? 1) - 1;
  return (row.hi ?? 0) + 1;
}

// Runs one tool. Returns { result, change, id } where result goes back to
// Claude, change is a short line the page shows, like "Added to Next up: Get
// groceries", and id is the new row's id when something was added. today is
// the person's own date (see localToday).
export async function runTool(userId, name, input = {}, turn = "none", today = localToday()) {
  const log = (kind, action, rowId, before, label) => record(userId, turn, kind, action, rowId, before, label);
  try {
    switch (name) {
      case "add_goal": {
        const g = goalChanges(input);
        if (!g.title) throw new ToolError("A goal needs a title.");
        const [row] = await sql`
          insert into goals (user_id, title, area, kind, due, target, progress, unit, steps, notes)
          values (${userId}, ${g.title}, ${g.area ?? null}, ${g.kind ?? "count"}, ${g.due ?? null},
            ${g.target ?? null}, ${g.progress ?? 0}, ${g.unit ?? null},
            ${g.steps ? sql.json(g.steps) : null}, ${g.notes ?? null})
          returning id`;
        const id = Number(row.id);
        return { id, result: `Added goal ${id}.`, change: await log("goal", "add", id, null, `Added goal: ${g.title}`) };
      }
      case "update_goal": {
        const goal = await ownGoal(userId, input.goal_id);
        if (!goal) throw new ToolError("Which goal? goal_id is missing.");
        const g = goalChanges(input);
        if (!Object.keys(g).length) throw new ToolError("Nothing to change.");
        const before = pick(goal, Object.keys(g));
        const set = { ...g };
        if ("steps" in set) set.steps = set.steps ? sql.json(set.steps) : null;
        if ("steps" in before) before.steps = before.steps ?? null;
        await sql`update goals set ${sql(set)} where id = ${goal.id} and user_id = ${userId}`;
        const label = g.done === true ? `Goal done: ${goal.title}` : `Updated goal: ${g.title ?? goal.title}`;
        return { result: "Updated.", change: await log("goal", "update", goal.id, before, label) };
      }
      case "delete_goal": {
        const goal = await ownGoal(userId, input.goal_id);
        if (!goal) throw new ToolError("Which goal? goal_id is missing.");
        // Remember what pointed at it, so an undo can link them back.
        const todoIds = await sql`select id from todos where goal_id = ${goal.id} and user_id = ${userId}`;
        const logIds = await sql`select id from log where goal_id = ${goal.id} and user_id = ${userId}`;
        await sql`delete from goals where id = ${goal.id} and user_id = ${userId}`;
        const before = { row: goal, todo_ids: todoIds.map((t) => t.id), log_ids: logIds.map((l) => l.id) };
        return { result: "Deleted.", change: await log("goal", "delete", goal.id, before, `Deleted goal: ${goal.title}`) };
      }
      case "add_todo": {
        const t = text(input.text, "text", { required: true });
        const goal = await ownGoal(userId, input.goal_id ?? null);
        const where = input.place == null ? "bottom" : oneOf(input.place, ["top", "bottom"], "place");
        const position = await positionFor(userId, where);
        const [row] = await sql`
          insert into todos (user_id, goal_id, text, due, time, position)
          values (${userId}, ${goal?.id ?? null}, ${t}, ${date(input.due)}, ${text(input.time, "time")}, ${position})
          returning id`;
        const id = Number(row.id);
        return { id, result: `Added todo ${id}.`, change: await log("todo", "add", id, null, `Added to Next up: ${t}`) };
      }
      case "update_todo": {
        const [todo] = await sql`select * from todos where id = ${input.todo_id ?? null} and user_id = ${userId}`;
        if (!todo) throw new ToolError(`There's no todo with id ${input.todo_id}.`);
        const t = {};
        if ("text" in input) t.text = text(input.text, "text", { required: true });
        if ("time" in input) t.time = text(input.time, "time");
        if ("due" in input) t.due = date(input.due);
        if ("goal_id" in input) t.goal_id = (await ownGoal(userId, input.goal_id))?.id ?? null;
        if ("done" in input) {
          t.done = Boolean(input.done);
          t.done_at = t.done ? new Date() : null;
          t.done_on = t.done ? today : null;
        }
        if ("before_todo_id" in input) {
          t.position = await positionFor(userId, null, input.before_todo_id, todo.id);
        } else if ("place" in input) {
          t.position = await positionFor(userId, oneOf(input.place, ["top", "bottom"], "place"), null, todo.id);
        }
        if (!Object.keys(t).length) throw new ToolError("Nothing to change.");
        const before = pick(todo, Object.keys(t));
        await sql`update todos set ${sql(t)} where id = ${todo.id} and user_id = ${userId}`;
        const label = t.text ?? todo.text;
        const line =
          t.done === true ? `Done: ${label}`
          : t.done === false ? `Back in Next up: ${label}`
          : "position" in t && Object.keys(t).length === 1 ? `Moved: ${label}`
          : `Updated: ${label}`;
        return { result: "Updated.", change: await log("todo", "update", todo.id, before, line) };
      }
      case "delete_todo": {
        const [todo] = await sql`
          delete from todos where id = ${input.todo_id ?? null} and user_id = ${userId} returning *`;
        if (!todo) throw new ToolError(`There's no todo with id ${input.todo_id}.`);
        return { result: "Deleted.", change: await log("todo", "delete", todo.id, { row: todo }, `Deleted: ${todo.text}`) };
      }
      case "add_log": {
        const t = text(input.text, "text", { required: true });
        const goal = await ownGoal(userId, input.goal_id ?? null);
        const when = date(input.date) ?? today;
        const [row] = await sql`
          insert into log (user_id, goal_id, text, date)
          values (${userId}, ${goal?.id ?? null}, ${t}, ${when})
          returning id`;
        const id = Number(row.id);
        return { id, result: `Logged ${id}.`, change: await log("log", "add", id, null, `Logged: ${t}`) };
      }
      case "delete_log": {
        const [entry] = await sql`
          delete from log where id = ${input.log_id ?? null} and user_id = ${userId} returning *`;
        if (!entry) throw new ToolError(`There's no log entry with id ${input.log_id}.`);
        return { result: "Deleted.", change: await log("log", "delete", entry.id, { row: entry }, `Removed from Log: ${entry.text}`) };
      }
      case "add_tried": {
        const n = text(input.name, "name", { required: true });
        const status = oneOf(input.status, STATUSES, "status");
        const [row] = await sql`
          insert into tried (user_id, name, status, why, date)
          values (${userId}, ${n}, ${status}, ${text(input.why, "why")}, ${today})
          returning id`;
        const id = Number(row.id);
        return { id, result: `Added ${id}.`, change: await log("tried", "add", id, null, `Tried: ${n} (${status})`) };
      }
      case "update_tried": {
        const [item] = await sql`select * from tried where id = ${input.tried_id ?? null} and user_id = ${userId}`;
        if (!item) throw new ToolError(`There's nothing on the Tried list with id ${input.tried_id}.`);
        const t = {};
        if ("name" in input) t.name = text(input.name, "name", { required: true });
        if ("status" in input) t.status = oneOf(input.status, STATUSES, "status");
        if ("why" in input) t.why = text(input.why, "why");
        if (!Object.keys(t).length) throw new ToolError("Nothing to change.");
        await sql`update tried set ${sql(t)} where id = ${item.id} and user_id = ${userId}`;
        return { result: "Updated.", change: await log("tried", "update", item.id, pick(item, Object.keys(t)), `Tried: ${t.name ?? item.name} (${t.status ?? item.status})`) };
      }
      case "delete_tried": {
        const [item] = await sql`
          delete from tried where id = ${input.tried_id ?? null} and user_id = ${userId} returning *`;
        if (!item) throw new ToolError(`There's nothing on the Tried list with id ${input.tried_id}.`);
        return { result: "Deleted.", change: await log("tried", "delete", item.id, { row: item }, `Removed from Tried: ${item.name}`) };
      }
      default:
        throw new ToolError(`Unknown tool ${name}.`);
    }
  } catch (err) {
    if (err instanceof ToolError) return { result: err.message, error: true };
    throw err;
  }
}

const TABLES = { goal: "goals", todo: "todos", log: "log", tried: "tried" };

// Undo every change from one chat reply (or one tap on the page), newest
// first, so everything goes back to how it was before. Only the signed-in
// person's own changes can be undone. Returns the lines that were undone.
export async function undoTurn(userId, turn) {
  return sql.begin(async (tx) => {
    const rows = await tx`
      select id, kind, action, row_id, before, label from changes
      where user_id = ${userId} and turn = ${turn} and not undone
      order by id desc
      for update`;
    for (const c of rows) {
      const table = tx(TABLES[c.kind]);
      if (c.action === "add") {
        await tx`delete from ${table} where id = ${c.row_id} and user_id = ${userId}`;
      } else if (c.action === "update") {
        const before = { ...c.before };
        if (c.kind === "goal" && "steps" in before) before.steps = before.steps == null ? null : tx.json(before.steps);
        await tx`update ${table} set ${tx(before)} where id = ${c.row_id} and user_id = ${userId}`;
      } else {
        const row = { ...c.before.row, user_id: userId };
        if (c.kind === "goal" && row.steps != null) row.steps = tx.json(row.steps);
        await tx`insert into ${table} ${tx(row)} on conflict (id) do nothing`;
        if (c.kind === "goal") {
          for (const [other, ids] of [["todos", c.before.todo_ids], ["log", c.before.log_ids]]) {
            if (!ids?.length) continue;
            await tx`
              update ${tx(other)} set goal_id = ${c.row_id}
              where user_id = ${userId} and goal_id is null and id in ${tx(ids)}`;
          }
        }
      }
      await tx`update changes set undone = true where id = ${c.id}`;
    }
    return rows.map((c) => c.label);
  });
}
