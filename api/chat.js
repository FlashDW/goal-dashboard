// The "Talk it through" chat's server piece. It runs on Vercel as a serverless
// function, so the Anthropic API key stays on the server and never reaches the
// browser (anyone can read browser code on a public site).
//
// Settings, all set in Vercel under Project > Settings > Environment Variables:
//   ANTHROPIC_API_KEY  the key from console.anthropic.com (required)
//   CHAT_PASSCODE      a passcode you type once in the chat, so strangers who
//                      find this URL can't spend your API credit (required)
//   ALLOWED_ORIGIN     the site allowed to call this, default the GitHub Pages site

import Anthropic from "@anthropic-ai/sdk";
import { timingSafeEqual } from "node:crypto";

const MODEL = "claude-opus-5-5";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://flashdw.github.io";

// Limits that keep one request small and cheap.
const MAX_TURNS = 30;
const MAX_TEXT = 2000;
const MAX_DATA = 20000;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const SYSTEM = `You are the coach inside Asher's personal goals dashboard. Asher is a high school student. Talk like a friendly, practical older friend: short replies (two to four sentences), plain words, no lists unless asked, and end with at most one question.

Help Asher think through the goal area they opened the chat from. You can see the whole dashboard (goals, the Next up list, the log, and things already tried) as JSON in the first message. Use it to give specific advice, not generic tips.

When a concrete change to the dashboard would help, offer it as a suggestion. Asher sees it with Accept, Edit and Skip buttons, so mention it in your reply in one short sentence ("Want me to add that to Next up?") rather than repeating the details. Offer at most one suggestion per reply, and only when it clearly helps. Kinds of suggestion:
- field "next": add a task to Next up. "value" is the task, written as a short action. "time" is a rough length like "15 min" or "an afternoon".
- field "due": change a goal's target date. "value" is a date as YYYY-MM-DD. "time" is "".
- field "target": change a goal's target number. "value" is the number, like "4". "time" is "". Only for goals that have a target.
"goal" is the id of the goal the suggestion is for, copied exactly from the data.

Lift weights and reps live in another app (Hevy). The dashboard only tracks that a workout happened, so don't suggest logging lift numbers here.`;

// The answer always comes back as JSON in this shape.
const REPLY_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
      suggestions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            goal: { type: "string" },
            field: { type: "string", enum: ["next", "due", "target"] },
            value: { type: "string" },
            time: { type: "string" },
          },
          required: ["goal", "field", "value", "time"],
          additionalProperties: false,
        },
      },
    },
    required: ["reply", "suggestions"],
    additionalProperties: false,
  },
};

function passcodeOk(given) {
  const expected = process.env.CHAT_PASSCODE;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Checks what the browser sent and turns it into the messages Claude reads.
function buildMessages(body) {
  const { area, dashboard, history } = body || {};
  if (typeof area !== "string" || !Array.isArray(history)) return null;
  if (history.length === 0 || history.length > MAX_TURNS) return null;

  const turns = [];
  for (const [i, turn] of history.entries()) {
    const role = i % 2 === 0 ? "user" : "assistant"; // turns alternate, starting with Asher
    if (turn?.role !== role || typeof turn.text !== "string") return null;
    const text = turn.text.trim().slice(0, MAX_TEXT);
    if (!text) return null;
    turns.push({ role, content: text });
  }
  if (turns.at(-1).role !== "user") return null;

  const data = JSON.stringify(dashboard ?? {}).slice(0, MAX_DATA);
  const context =
    `Today is ${new Date().toISOString().slice(0, 10)}. Asher opened the chat from the "${area.slice(0, 100)}" area.\n\n` +
    `The dashboard right now:\n${data}\n\n---\n\n`;
  turns[0] = { role: "user", content: context + turns[0].content };
  return turns;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Chat-Passcode");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  if (!process.env.ANTHROPIC_API_KEY || !process.env.CHAT_PASSCODE) {
    return res.status(500).json({ error: "The chat server isn't set up yet: ANTHROPIC_API_KEY and CHAT_PASSCODE need to be set in Vercel." });
  }
  if (!passcodeOk(req.headers["x-chat-passcode"])) {
    return res.status(401).json({ error: "Wrong passcode." });
  }

  const messages = buildMessages(req.body);
  if (!messages) return res.status(400).json({ error: "That message didn't look right. Try again." });

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: REPLY_FORMAT },
      // If a safety check declines, the API retries on a suitable other model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages,
    });

    if (response.stop_reason === "refusal") {
      return res.status(200).json({ reply: "I can't help with that one. Want to talk about something else on this goal?", suggestions: [] });
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    const parsed = text && JSON.parse(text);
    if (!parsed || typeof parsed.reply !== "string") throw new Error("Unexpected reply: " + response.stop_reason);

    return res.status(200).json({ reply: parsed.reply, suggestions: parsed.suggestions ?? [] });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic rejected the API key");
      return res.status(500).json({ error: "The API key in Vercel isn't working. Check ANTHROPIC_API_KEY." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Too many messages at once. Wait a minute and try again." });
    }
    console.error(err);
    return res.status(502).json({ error: "Claude didn't answer this time. Try again in a moment." });
  }
}
