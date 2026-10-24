// Log out: forgets this browser's sign-in token.

import { endSession } from "../lib/auth.js";
import { route } from "../lib/http.js";

export default route(["POST"], async (req, res) => {
  await endSession(req);
  return res.status(200).json({ ok: true });
});
