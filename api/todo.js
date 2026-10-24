// Tick, untick or delete a todo straight from the list, without the chat.
// Body: { id, done: true|false } or { id, delete: true }

import { sql, loadState } from "../lib/db.js";
import { route, body } from "../lib/http.js";

export default route(["POST"], async (req, res, user) => {
  const { id, done } = body(req);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Which todo?" });

  if (body(req).delete === true) {
    await sql`delete from todos where id = ${id} and user_id = ${user.id}`;
  } else if (typeof done === "boolean") {
    await sql`
      update todos set done = ${done}, done_at = ${done ? sql`now()` : null}
      where id = ${id} and user_id = ${user.id}`;
  } else {
    return res.status(400).json({ error: "Nothing to change." });
  }
  return res.status(200).json(await loadState(user.id));
}, { auth: true });
