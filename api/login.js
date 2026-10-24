// Log in with name + password. After 10 wrong passwords in a row the account
// waits 15 minutes before it accepts another try, so nobody can guess forever.

import { sql, loadState } from "../lib/db.js";
import { checkPassword, nameKey, startSession } from "../lib/auth.js";
import { route, body } from "../lib/http.js";
import { recentMessages } from "../lib/chat.js";

const MAX_FAILS = 10;

export default route(["POST"], async (req, res) => {
  const { name, password } = body(req);
  const wrong = () => res.status(401).json({ error: "That name and password don't match." });
  if (typeof password !== "string" || !nameKey(name)) return wrong();

  const [found] = await sql`
    select id, name, password_hash, failed_logins, locked_until > now() as locked
    from users where name_key = ${nameKey(name)}`;
  if (!found) return wrong();
  if (found.locked) return res.status(429).json({ error: "Too many wrong tries. Wait 15 minutes and try again." });

  if (!(await checkPassword(password, found.password_hash))) {
    const fails = found.failed_logins + 1;
    await sql`
      update users set
        failed_logins = ${fails >= MAX_FAILS ? 0 : fails},
        locked_until = ${fails >= MAX_FAILS ? sql`now() + interval '15 minutes'` : null}
      where id = ${found.id}`;
    return wrong();
  }

  await sql`update users set failed_logins = 0, locked_until = null where id = ${found.id}`;
  const user = { id: Number(found.id), name: found.name };
  const token = await startSession(user.id);
  return res.status(200).json({ token, user, ...(await loadState(user.id)), messages: await recentMessages(user.id) });
});
