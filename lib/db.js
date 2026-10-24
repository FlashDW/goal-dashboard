// The database connection and table setup. Every person's goals, todos and
// chat messages live in one Postgres database, and every query filters by the
// signed-in person's user_id, so nobody can see anyone else's.
//
// Setting (Vercel > Project > Settings > Environment Variables):
//   DATABASE_URL  the Postgres connection string. Vercel adds it for you when
//                 you connect a Neon database under the project's Storage tab.

import postgres from "postgres";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

export const sql = url
  ? postgres(url, {
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
      max: 1, // serverless: one connection per running copy of the function
      idle_timeout: 20,
      prepare: false, // works with Neon's and Supabase's connection poolers
    })
  : null;

// Creates the tables the first time the server runs, so there's no SQL to type
// by hand. "if not exists" makes it safe to run every time.
const SCHEMA = `
create table if not exists users (
  id bigserial primary key,
  name text not null,
  name_key text not null unique,
  password_hash text not null,
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  token_hash text primary key,
  user_id bigint not null references users(id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists goals (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  title text not null,
  area text,
  due text,
  target double precision,
  progress double precision not null default 0,
  unit text,
  notes text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists todos (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  goal_id bigint references goals(id) on delete set null,
  text text not null,
  due text,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists messages (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists goals_user on goals(user_id);
create index if not exists todos_user on todos(user_id);
create index if not exists messages_user on messages(user_id, created_at);
create index if not exists sessions_user on sessions(user_id);
`;

let ready;
export function ensureSchema() {
  if (!sql) throw new Error("DATABASE_URL isn't set");
  ready ??= sql.unsafe(SCHEMA).catch((err) => {
    ready = undefined; // try again on the next request
    throw err;
  });
  return ready;
}

// Everything the page shows for one person.
export async function loadState(userId) {
  const goals = await sql`
    select id, title, area, due, target, progress, unit, notes, done
    from goals where user_id = ${userId} order by done, created_at`;
  const todos = await sql`
    select id, goal_id, text, due, done
    from todos where user_id = ${userId}
      and (not done or done_at > now() - interval '7 days')
    order by done, due nulls last, created_at`;
  return { goals: goals.map(plain), todos: todos.map(plain) };
}

// Postgres ids are big numbers that arrive as strings; the page wants numbers.
function plain(row) {
  const out = { ...row, id: Number(row.id) };
  if ("goal_id" in row) out.goal_id = row.goal_id == null ? null : Number(row.goal_id);
  return out;
}
