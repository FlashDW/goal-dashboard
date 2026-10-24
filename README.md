# goal-dashboard

A goals app you talk to. Make an account with a name and password, then chat
with an AI that keeps your goals and todos for you: "add a todo for getting
groceries", "I want to run a 5K by June", "I finished my essay". Your goals and
todos sit next to the chat, and they're saved in a database, so they're still
there when you reload or log in from another device. Everyone who signs up gets
their own private list.

## How it's built

Plain HTML, CSS and JavaScript in the browser, no framework and no build step,
plus a few small server files that run on Vercel.

| File | What it does |
| --- | --- |
| `index.html` | The page: the log-in box, and the chat with your Todos and Goals beside it |
| `style.css` | How it looks, including phone layout and dark mode |
| `app.js` | Logs you in, sends chat messages, and draws your lists |
| `api/signup.js`, `api/login.js`, `api/logout.js` | Making an account, logging in and out |
| `api/me.js` | Sends the page your goals, todos and recent chat when it opens |
| `api/chat.js` | Passes your message to Claude, which can add and change your goals and todos |
| `api/todo.js` | Ticking or deleting a todo straight from the list |
| `api/undo.js` | The Undo button: reverses everything the AI changed in one reply |
| `lib/db.js` | The database connection, and the tables (it creates and updates them itself, see "Changing the database" below) |
| `lib/auth.js` | Password hashing and sign-in tokens |
| `lib/chat.js` | The tools Claude uses to change goals and todos |
| `package.json` | Tells Vercel to install the two libraries the server uses, and how to run the tests |
| `test/` | Automatic checks: passwords, the AI's tools, undo, and that nobody can touch someone else's list |
| `.github/workflows/test.yml` | Runs the tests on GitHub for every pull request |

### How it keeps things safe

- **Passwords** are never stored. The database keeps a scrambled version (a
  scrypt hash) that can check a password but can't be turned back into one.
- **Your list is yours.** Every database query is limited to the logged-in
  person. The AI's tools get the user from the login, never from the AI, so
  even if someone tricks the AI it can only touch their own list.
- **Strangers can't run up the bill.** Making an account needs an invite code
  (the `CHAT_PASSCODE` setting; four random words make a good one), each
  person can send at most 60 chat messages a day (`DAILY_MESSAGE_LIMIT`), and
  everyone together at most 200 a day (`TOTAL_DAILY_LIMIT`). That total is the
  real ceiling on the AI bill, because an invite code can be passed around.
- **Every AI change can be undone.** The AI makes small changes right away,
  and each reply that changed something has an Undo button that puts it all
  back.
- **Guessing passwords** is slowed down: after 10 wrong tries an account waits
  15 minutes.
- The API key and database password live only in Vercel's settings, never in
  this repo or the page.

## Setup (needs a parent for the accounts)

The AI part (steps 1 to 3) is already done if the old chat worked.

1. **API key.** At https://console.anthropic.com create an API key and add some
   credit. Under Limits, set a low monthly spend limit (like $10). Keep the key
   private: don't paste it into a chat, a file in this repo, or a message.
2. **Vercel.** At https://vercel.com sign in with GitHub, choose Add New >
   Project, and import `goal-dashboard`.
3. **Secrets.** In the Vercel project go to Settings > Environment Variables
   and add:
   - `ANTHROPIC_API_KEY`: the key from step 1.
   - `CHAT_PASSCODE`: the invite code people type when they make an account.
     Share it only with people you want using the app.
   - `ALLOWED_ORIGIN` (only if the site isn't at https://flashdw.github.io):
     the address of the site that may use the server.
4. **Database.** In the Vercel project open the **Storage** tab, choose
   **Create Database**, pick **Neon** (Serverless Postgres), keep the free plan,
   and connect it to this project for all environments. Vercel adds the
   `DATABASE_URL` setting by itself. The tables are created automatically the
   first time someone uses the app.
5. **Redeploy.** Open Deployments and Redeploy so the server picks up the new
   settings.

`SERVER_URL` in `app.js` points at the Vercel project's main address,
https://goal-dashboard-one.vercel.app , which the GitHub Pages site uses. That
address also shows the whole app, so you can use either one.

## Changing the database

`lib/db.js` keeps the database layout as a numbered list of steps
(`MIGRATIONS`). When the server starts it runs any step that hasn't run yet
and remembers it in a `schema_migrations` table, so there's still no SQL to
type by hand. To change the layout, add a new step at the end of the list.
Never edit a step that's already live: the database won't run it again.

## Tests

`npm test` runs the checks. On your computer the database tests are skipped
unless `TEST_DATABASE_URL` points at an empty throwaway Postgres database
(never the real one, the tests wipe it). On GitHub every pull request runs all
of them automatically with a fresh database; a red X on the PR means something
broke.

## Run it on your computer

The app needs its server, so `python -m http.server` isn't enough any more.
Install Node.js and the Vercel command line tool (`npm i -g vercel`), run
`vercel link` once, then `vercel env pull` (this copies the settings into a
local `.env.local`, which git ignores) and `vercel dev`. Open the address it
prints. Note this uses the same database as the live site.

To check the phone layout, open the browser's dev tools (F12) and turn on the
device toolbar (Ctrl+Shift+M).
