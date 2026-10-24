// Undo button: reverses every change the AI made in one chat reply, or one
// tap on the page.
// Body: { turn } — the "undo" value the chat sent back with that reply.

import { sql, loadState } from "../lib/db.js";
import { route, body } from "../lib/http.js";
import { undoTurn } from "../lib/chat.js";

export default route(["POST"], async (req, res, user) => {
  const { turn } = body(req);
  if (typeof turn !== "string" || !turn) return res.status(400).json({ error: "Which reply should be undone?" });

  const undone = await undoTurn(user.id, turn);
  if (!undone.length) return res.status(200).json({ undone, ...(await loadState(user.id)) });

  // Note it in the chat, so the AI knows it happened next time. Taps on the
  // page (api/edit.js) never showed up in the chat, so their undo doesn't either.
  if (turn.startsWith("manual:")) return res.status(200).json({ undone, ...(await loadState(user.id)) });
  const note = "Undid: " + undone.join("; ");
  await sql`insert into messages (user_id, role, text) values (${user.id}, 'assistant', ${note})`;
  return res.status(200).json({ undone, note, ...(await loadState(user.id)) });
}, { auth: true });
