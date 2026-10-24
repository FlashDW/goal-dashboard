// Make an account: name + password, plus the invite code.

import { sql, loadState } from "../lib/db.js";
import { hashPassword, cleanName, nameKey, startSession, inviteOk } from "../lib/auth.js";
import { route, body } from "../lib/http.js";

export default route(["POST"], async (req, res) => {
  const { name, password, invite } = body(req);
  const shown = cleanName(name);

  if (!process.env.CHAT_PASSCODE) {
    return res.status(500).json({ error: "Sign-up isn't set up yet: CHAT_PASSCODE needs to be set in Vercel." });
  }
  if (!inviteOk(invite)) return res.status(403).json({ error: "That invite code isn't right." });
  if (shown.length < 2 || shown.length > 40) return res.status(400).json({ error: "Pick a name between 2 and 40 characters." });
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: "Use a password of at least 8 characters." });
  }

  const rows = await sql`
    insert into users (name, name_key, password_hash)
    values (${shown}, ${nameKey(shown)}, ${await hashPassword(password)})
    on conflict (name_key) do nothing
    returning id, name`;
  if (!rows[0]) return res.status(409).json({ error: "Someone already has that name. Try adding a last initial." });

  const user = { id: Number(rows[0].id), name: rows[0].name };
  const token = await startSession(user.id);
  return res.status(200).json({ token, user, ...(await loadState(user.id)), messages: [] });
});
