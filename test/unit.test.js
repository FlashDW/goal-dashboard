// Tests for the safety checks that don't need a database. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanName, nameKey, hashPassword, checkPassword, inviteOk } from "../lib/auth.js";
import { goalChanges, isDate, localToday, ToolError } from "../lib/chat.js";

test("names are tidied for display and matched without case", () => {
  assert.equal(cleanName("  Asher   U "), "Asher U");
  assert.equal(nameKey("ASHER u"), "asher u");
  assert.equal(cleanName(42), "");
});

test("a password hash checks the right password and rejects others", async () => {
  const stored = await hashPassword("correct horse");
  assert.ok(!stored.includes("correct horse"));
  assert.equal(await checkPassword("correct horse", stored), true);
  assert.equal(await checkPassword("wrong horse", stored), false);
  assert.equal(await checkPassword("anything", "not-a-hash"), false);
});

test("the invite code must match exactly", () => {
  process.env.CHAT_PASSCODE = "blue-otter";
  assert.equal(inviteOk("blue-otter"), true);
  assert.equal(inviteOk(" blue-otter "), true);
  assert.equal(inviteOk("blue-otte"), false);
  assert.equal(inviteOk(undefined), false);
  delete process.env.CHAT_PASSCODE;
  assert.equal(inviteOk("blue-otter"), false);
});

test("dates must be real YYYY-MM-DD dates", () => {
  assert.equal(isDate("2027-06-01"), true);
  assert.equal(isDate("June 1"), false);
  assert.equal(isDate("2027-13-40"), false);
});

test("goal changes keep only checked fields the AI sent", () => {
  assert.deepEqual(goalChanges({ title: "  Run a 5K ", due: "2027-06-01" }), { title: "Run a 5K", due: "2027-06-01" });
  assert.deepEqual(goalChanges({ progress: 2 }), { progress: 2 });
  assert.throws(() => goalChanges({ due: "tomorrow" }), ToolError);
  assert.throws(() => goalChanges({ target: "three" }), ToolError);
  assert.throws(() => goalChanges({ title: "" }), ToolError);
  assert.equal(goalChanges({ notes: "x".repeat(1000) }).notes.length, 300);
});

test("the page's local date is used when it's within a day of the server's", () => {
  const now = new Date("2026-10-25T01:00:00Z"); // 9pm Oct 24 in Pittsburgh
  assert.equal(localToday("2026-10-24", now), "2026-10-24");
  assert.equal(localToday("2026-10-26", now), "2026-10-26");
  assert.equal(localToday("2027-01-01", now), "2026-10-25");
  assert.equal(localToday(undefined, now), "2026-10-25");
});
