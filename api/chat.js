// The chat. You type something like "add a todo for getting groceries", Claude
// answers and, when you ask for a change, uses its tools (lib/chat.js) to add
// or change your goals and todos in the database.
//
// Settings, all set in Vercel under Project > Settings > Environment Variables:
//   ANTHROPIC_API_KEY    the key from console.anthropic.com (required)
//   DATABASE_URL         see lib/db.js (required)
//   CHAT_PASSCODE        the invite code for making an account (see api/signup.js)
//   DAILY_MESSAGE_LIMIT  messages each person can send per day, default 60
//   TOTAL_DAILY_LIMIT    messages everyone together can send per day, default
//                        200. This is the real ceiling on the AI bill, since the
//                        invite code can be passed around.

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { sql, loadState } from "../lib/db.js";
import { route, body } from "../lib/http.js";
import { TOOLS, runTool, recentMessages, localToday } from "../lib/chat.js";

// Claude Haiku 5.5: small, fast and very cheap (well under a cent a message).
// For a smarter but pricier coach, use "claude-opus-5-5".
const MODEL = "claude-haiku-5-5";
const MAX_TEXT = 2000;
const HISTORY = 20; // how many earlier messages Claude sees
const MAX_ROUNDS = 6; // tool-use rounds per message, so one message can't loop forever
const DAILY_LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT) || 60;
const TOTAL_LIMIT = Number(process.env.TOTAL_DAILY_LIMIT) || 200;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const SYSTEM = `You are the assistant inside a personal goals app. The person chatting is usually a high school student. You keep their goals and todos for them: when they ask to add, change, tick off or remove something, do it with your tools right away, then confirm in one short sentence. Don't ask for permission first for small changes; do ask before deleting a goal.

Goals are bigger things worked toward over weeks or months (optionally with a target number and a date). Todos are single concrete tasks. Link a todo to a goal with goal_id when it clearly belongs to one. "I did X" or "finished X" usually means ticking off a matching todo (done: true) or adding progress to a goal.

You can also help them think: break a goal into todos, plan a week, or pick what to do next. Talk like a friendly, practical older friend: short replies (one to three sentences), plain words, no lists unless asked, at most one question.

The current goals and todos, with their ids, come as JSON at the top of the latest message. Use the ids exactly as given. Never mention ids, JSON or tool names to the person. Today's date is in that message too; turn "Friday" or "next week" into real YYYY-MM-DD dates.`;

function contextNote(user, state, today) {
  const weekday = new Date(today + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `[Today is ${weekday} ${today}. You're talking with ${user.name}. Their goals and todos right now:\n${JSON.stringify(state)}]\n\n`;
}

// Earlier chat as Claude messages. Must start with the person speaking.
function history(rows) {
  const turns = rows.map((r) => ({ role: r.role, content: r.text }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

export default route(["POST"], async (req, res, user) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "The chat isn't set up yet: ANTHROPIC_API_KEY needs to be set in Vercel." });
  }
  const text = typeof body(req).text === "string" ? body(req).text.trim().slice(0, MAX_TEXT) : "";
  if (!text) return res.status(400).json({ error: "Type a message first." });

  const [{ count }] = await sql`
    select count(*)::int as count from messages
    where user_id = ${user.id} and role = 'user' and created_at > now() - interval '1 day'`;
  if (count >= DAILY_LIMIT) {
    return res.status(429).json({ error: `That's ${DAILY_LIMIT} messages today, the daily limit. Try again tomorrow.` });
  }
  const [{ total }] = await sql`
    select count(*)::int as total from messages
    where role = 'user' and created_at > now() - interval '1 day'`;
  if (total >= TOTAL_LIMIT) {
    return res.status(429).json({ error: "The app has used up today's AI messages for everyone. Try again tomorrow." });
  }

  const earlier = await recentMessages(user.id, HISTORY);
  await sql`insert into messages (user_id, role, text) values (${user.id}, 'user', ${text})`;

  const messages = [
    ...history(earlier),
    { role: "user", content: contextNote(user, await loadState(user.id), localToday(body(req).today)) + text },
  ];
  const turn = randomUUID(); // tags this reply's changes so they can be undone together
  const changes = [];
  const undo = () => (changes.length ? { undo: turn } : {});
  let reply = "";

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === "refusal") {
        reply = "I can't help with that one. Want to work on one of your goals instead?";
        break;
      }
      reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim() || reply;
      if (response.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: response.content });
      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const { result, change, error } = await runTool(user.id, block.name, block.input, turn);
        if (change) changes.push(change);
        results.push({ type: "tool_result", tool_use_id: block.id, content: result, ...(error && { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic rejected the API key");
      return res.status(500).json({ error: "The API key in Vercel isn't working. Check ANTHROPIC_API_KEY.", changes, ...undo(), ...(await loadState(user.id)) });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many messages at once. Wait a minute and try again.", changes, ...undo(), ...(await loadState(user.id)) });
    }
    console.error(err);
    return res.status(502).json({ error: "Claude didn't answer this time. Try again in a moment.", changes, ...undo(), ...(await loadState(user.id)) });
  }

  if (!reply) reply = changes.length ? "Done." : "Sorry, I lost my train of thought. Can you say that again?";
  await sql`insert into messages (user_id, role, text) values (${user.id}, 'assistant', ${reply})`;
  return res.status(200).json({ reply, changes, ...undo(), ...(await loadState(user.id)) });
}, { auth: true });
