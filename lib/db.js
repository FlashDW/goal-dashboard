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
      onnotice: () => {}, // skip "already exists" chatter in the logs
    })
  : null;

// The database layout, as numbered steps ("migrations"). Each step runs once,
// automatically, the first time the server starts after it's added, so there's
// still no SQL to type by hand. The schema_migrations table remembers which
// steps already ran.
//
// To change the layout later: add a new step at the end of the list. Never edit
// or reorder a step that's already live; the database won't run it again.
export const MIGRATIONS = [
  // 1: users, sign-in sessions, goals, todos and chat messages
  `
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
`,
  // 2: a record of every change the AI makes, with what it replaced, so a
  // whole reply's changes can be undone
  `
create table changes (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  turn text not null,
  kind text not null check (kind in ('goal', 'todo')),
  action text not null check (action in ('add', 'update', 'delete')),
  row_id bigint not null,
  before jsonb,
  label text not null,
  undone boolean not null default false,
  created_at timestamptz not null default now()
);
create index changes_turn on changes(user_id, turn);
`,
];

// Runs any steps that haven't run yet. The advisory lock means two copies of
// the server starting at the same moment take turns instead of both running a
// step.
async function migrate() {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx`create table if not exists schema_migrations (
      version int primary key, ran_at timestamptz not null default now())`;
    const done = new Set((await tx`select version from schema_migrations`).map((r) => r.version));
    for (const [i, step] of MIGRATIONS.entries()) {
      const version = i + 1;
      if (done.has(version)) continue;
      await tx.unsafe(step);
      await tx`insert into schema_migrations (version) values (${version})`;
    }
  });
}

let ready;
export function ensureSchema() {
  if (!sql) throw new Error("DATABASE_URL isn't set");
  ready ??= migrate().catch((err) => {
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
