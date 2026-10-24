# goal-dashboard

A goals app with a coach you talk to. Make an account with a name and password
and you get a dashboard:

- **Next up**: one ordered list of tasks across every goal, each with a time
  ("10 min", "an afternoon"). Bored? Start at the top. Tick one and it moves to
  the Log.
- **This week**: weekly goals like 5 workouts, with a dot for each day and how
  many weeks in a row you've hit it.
- **Goal cards**: where each goal stands, its date, the next step, the last two
  things you logged, and a "Talk it through" button.
- **Log and Tried**: everything you've done, and everything you've tried (done,
  keeping, or ruled out, with why).

Beside it (or behind the bar at the bottom on a phone) is the chat. Tell the
coach what happened, "did push day", "move the recipe to the top", "I tried
robotics club but it's not for me", and it updates the dashboard. Everything it
changes, and everything you tap, can be undone. A new account can tap "Start
from my plan" to add the plan in `plan.json` in one go. It's all saved in a
database, so it's there when you reload or log in from another device, and
everyone who signs up gets their own private dashboard.

## How it's built

Plain HTML, CSS and JavaScript in the browser, no framework and no build step,
plus a few small server files that run on Vercel.

| File | What it does |
| --- | --- |
| `index.html` | The page: the log-in box, the dashboard, and the chat |
| `style.css` | How it looks, including phone layout and dark mode |
| `app.js` | Logs you in, draws the dashboard, and sends chat messages |
| `week.js` | Date math for weekly goals: this week's count and the streak |
| `plan.json` | The plan "Start from my plan" adds to a new account |
| `api/signup.js`, `api/login.js`, `api/logout.js` | Making an account, logging in and out |
| `api/me.js` | Sends the page your dashboard and recent chat when it opens |
| `api/chat.js` | Passes your message to Claude, which can update your dashboard |
| `api/edit.js` | Taps on the page: ticking, moving or deleting a task, logging a workout, "Start from my plan" |
| `api/undo.js` | The Undo button: reverses everything one chat reply or one tap changed |
| `lib/db.js` | The database connection, and the tables (it creates and updates them itself, see "Changing the database" below) |
| `lib/auth.js` | Password hashing and sign-in tokens |
| `lib/chat.js` | The tools Claude (and the page) use to change goals, Next up, the Log and Tried |
| `lib/plan.js` | Adds a whole plan at once, as one undoable change |
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
