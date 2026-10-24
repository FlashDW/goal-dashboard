// Everything the page needs when it opens: who you are, your goals and todos,
// and your recent chat.

import { loadState } from "../lib/db.js";
import { route } from "../lib/http.js";
import { recentMessages } from "../lib/chat.js";

export default route(["GET"], async (req, res, user) => {
  return res.status(200).json({ user, ...(await loadState(user.id)), messages: await recentMessages(user.id) });
}, { auth: true });
