// "Start from my plan": adds a whole plan (plan.json, sent by the page) to an
// empty account in one go. Every goal and task goes through the same checked
// tools as the AI, tagged with one turn, so a single Undo takes it all back.

import { runTool, undoTurn } from "./chat.js";

const MAX_GOALS = 30;
const MAX_TASKS = 50;
const GOAL_FIELDS = ["title", "area", "kind", "target", "unit", "due", "steps", "progress", "notes"];

export async function importPlan(userId, plan, turn, today) {
  const goals = Array.isArray(plan?.goals) ? plan.goals : null;
  const next = Array.isArray(plan?.next) ? plan.next : [];
  if (!goals || !goals.length) return { error: "That plan has no goals in it." };
  if (goals.length > MAX_GOALS || next.length > MAX_TASKS) return { error: "That plan is too big." };

  const ids = {}; // the plan's own goal keys -> new goal ids
  const fail = async (message) => {
    await undoTurn(userId, turn);
    return { error: `The plan couldn't be added: ${message}` };
  };

  for (const goal of goals) {
    const input = Object.fromEntries(GOAL_FIELDS.filter((k) => goal?.[k] !== undefined).map((k) => [k, goal[k]]));
    const r = await runTool(userId, "add_goal", input, turn, today);
    if (r.error) return fail(r.result);
    if (goal.key != null) ids[goal.key] = r.id;
  }
  for (const task of next) {
    const r = await runTool(userId, "add_todo", {
      text: task?.text,
      time: task?.time ?? null,
      goal_id: ids[task?.goal] ?? null,
    }, turn, today);
    if (r.error) return fail(r.result);
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return { change: `Added your plan: ${plural(goals.length, "goal")} and ${plural(next.length, "task")}` };
}
