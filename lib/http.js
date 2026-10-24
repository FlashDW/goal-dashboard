// Shared bits for every file in api/: who may call the server (CORS), the
// database check, and turning errors into friendly JSON.

import { sql, ensureSchema } from "./db.js";
import { currentUser } from "./auth.js";

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://flashdw.github.io";

// Wraps a handler. With { auth: true } it also looks up the signed-in person
// and passes them in, or answers 401 if nobody is signed in.
export function route(methods, handler, { auth = false } = {}) {
  return async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Vary", "Origin");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "OPTIONS") return res.status(204).end();
    if (!methods.includes(req.method)) return res.status(405).json({ error: `Use ${methods.join(" or ")}.` });

    if (!sql) {
      return res.status(500).json({ error: "The database isn't connected yet: DATABASE_URL needs to be set in Vercel." });
    }
    try {
      await ensureSchema();
      let user = null;
      if (auth) {
        user = await currentUser(req);
        if (!user) return res.status(401).json({ error: "Please log in again." });
      }
      return await handler(req, res, user);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Something went wrong on the server. Try again in a moment." });
    }
  };
}

export const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});
