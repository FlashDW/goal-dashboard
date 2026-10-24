// Date and weekly-goal math for the dashboard, kept apart from the page code
// so the tests can check it (test/week.test.js). Weeks start on Monday, and
// every date is a plain "YYYY-MM-DD" in the person's own time zone.

const DAY = 86400000;
const toTime = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const toDate = (t) => new Date(t).toISOString().slice(0, 10);

export function addDays(date, n) {
  return toDate(toTime(date) + n * DAY);
}

// The Monday on or before a date.
export function weekStart(date) {
  const weekday = (new Date(toTime(date)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -weekday);
}

// Whole days from a to b ("2026-10-24" to "2026-10-26" is 2).
export function daysBetween(a, b) {
  return Math.round((toTime(b) - toTime(a)) / DAY);
}

// How a weekly goal is going, from the Log lines (and ticked tasks) linked to it:
//   count   times this week
//   target  times per week
//   days    7 numbers, Monday to Sunday: how many times on each day this week
//   streak  weeks in a row the target was hit, counting this week once it's hit
export function weeklyStats(goal, log, today) {
  const target = Math.max(1, Math.round(goal.target || 1));
  const perWeek = new Map();
  const thisWeek = weekStart(today);
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const entry of log) {
    if (entry.goal_id !== goal.id || !entry.date || entry.date > today) continue;
    const week = weekStart(entry.date);
    perWeek.set(week, (perWeek.get(week) || 0) + 1);
    if (week === thisWeek) days[daysBetween(thisWeek, entry.date)]++;
  }
  const count = perWeek.get(thisWeek) || 0;
  let streak = count >= target ? 1 : 0;
  for (let week = addDays(thisWeek, -7); (perWeek.get(week) || 0) >= target; week = addDays(week, -7)) streak++;
  return { count, target, days, streak };
}
