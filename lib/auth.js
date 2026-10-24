// Accounts and sign-in. Passwords are never stored: only a scrypt hash of each
// one, which can check a password but can't be turned back into it. After
// signing in the browser gets a random token, and the database keeps only a
// hash of that too.

import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./db.js";

const scryptAsync = promisify(scrypt);
const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

// "  Asher U " -> shown as "Asher U", matched as "asher u"
export function cleanName(name) {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
}
export const nameKey = (name) => cleanName(name).toLowerCase();

const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

export async function startSession(userId) {
  const token = randomBytes(32).toString("base64url");
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${tokenHash(token)}, ${userId}, now() + ${SESSION_DAYS + " days"}::interval)`;
  await sql`delete from sessions where expires_at < now()`; // tidy up old ones
  return token;
}

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

// The signed-in person for this request, or null.
export async function currentUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const rows = await sql`
    select u.id, u.name from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash(token)} and s.expires_at > now()`;
  return rows[0] ? { id: Number(rows[0].id), name: rows[0].name } : null;
}

export async function endSession(req) {
  const token = bearer(req);
  if (token) await sql`delete from sessions where token_hash = ${tokenHash(token)}`;
}

// The invite code people type when they make an account. It reuses the
// CHAT_PASSCODE setting, so strangers who find the site can't sign up and
// spend the AI credit.
export function inviteOk(given) {
  const expected = process.env.CHAT_PASSCODE;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
