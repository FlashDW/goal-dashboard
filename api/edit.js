// Changes made by tapping on the page instead of chatting: ticking a Next up
// task, moving it to the top, deleting it, logging a workout, removing a Log
// line, and "Start from my plan". They go through the same checked tools as
// the AI (lib/chat.js), so they get the same Undo.
//
// Body: { action, today, ... } where action is one of
//   tick         { id, done }     tick or un-tick a task
//   top          { id }           move a task to the top of Next up
//   delete       { id }           delete a task
//   log          { goal_id, text } add a Log line (like one workout)
//   unlog        { id }           remove a Log line
//   import       { plan }         add a whole plan to an empty account
// Answers with the new dashboard plus { undo, change } for the Undo button.

import { randomUUID } from "node:crypto";
import { sql, loadState } from "../lib/db.js";
import { route, body } from "../lib/http.js";
import { runTool, localToday } from "../lib/chat.js";
import { importPlan } from "../lib/plan.js";

const ACTIONS = {
  tick: (b) => ["update_todo", { todo_id: b.id, done: b.done === true }],
  top: (b) => ["update_todo", { todo_id: b.id, place: "top" }],
  delete: (b) => ["delete_todo", { todo_id: b.id }],
  log: (b) => ["add_log", { goal_id: b.goal_id ?? null, text: b.text }],
  unlog: (b) => ["delete_log", { log_id: b.id }],
};

export default route(["POST"], async (req, res, user) => {
  const b = body(req);
  const today = localToday(b.today);
  // "manual:" tells api/undo.js not to post an "Undid" note in the chat.
  const turn = "manual:" + randomUUID();

  if (b.action === "import") {
    const [{ count }] = await sql`select count(*)::int as count from goals where user_id = ${user.id}`;
    if (count > 0) return res.status(409).json({ error: "You already have goals, so the plan wasn't added again." });
    const result = await importPlan(user.id, b.plan, turn, today);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(200).json({ undo: turn, change: result.change, ...(await loadState(user.id)) });
  }

  const action = ACTIONS[b.action];
  if (!action) return res.status(400).json({ error: "Nothing to change." });
  const [tool, input] = action(b);
  const { change, error, result } = await runTool(user.id, tool, input, turn, today);
  if (error) return res.status(400).json({ error: result, ...(await loadState(user.id)) });
  return res.status(200).json({ undo: turn, change, ...(await loadState(user.id)) });
}, { auth: true });
