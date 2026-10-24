// Tests for the weekly-goal math the dashboard uses (week.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, addDays, daysBetween, weeklyStats } from "../week.js";

test("weeks start on Monday", () => {
  assert.equal(weekStart("2026-10-24"), "2026-10-19"); // Saturday
  assert.equal(weekStart("2026-10-19"), "2026-10-19"); // Monday
  assert.equal(weekStart("2026-10-25"), "2026-10-19"); // Sunday
  assert.equal(weekStart("2027-01-01"), "2026-12-28"); // across the new year
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
});

test("a weekly goal counts this week's log lines and the streak of weeks hit", () => {
  const goal = { id: 1, target: 2 };
  const line = (date, goal_id = 1) => ({ goal_id, date });
  const log = [
    line("2026-10-20"), line("2026-10-22"), // this week (Oct 19 to 25): 2, hit
    line("2026-10-13"), line("2026-10-15"), line("2026-10-16"), // last week: 3, hit
    line("2026-10-07"), // the week before: 1, missed, so the streak stops
    line("2026-09-29"), line("2026-09-30"),
    line("2026-10-21", 2), // another goal
  ];
  const stats = weeklyStats(goal, log, "2026-10-24");
  assert.equal(stats.count, 2);
  assert.equal(stats.streak, 2);
  assert.deepEqual(stats.days, [0, 1, 0, 1, 0, 0, 0]);
});

test("a streak still counts past weeks before this week's target is hit", () => {
  const goal = { id: 1, target: 1 };
  const stats = weeklyStats(goal, [{ goal_id: 1, date: "2026-10-14" }], "2026-10-20");
  assert.equal(stats.count, 0);
  assert.equal(stats.streak, 1);
});
