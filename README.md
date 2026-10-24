# goal-dashboard

A one-page dashboard for my personal goals: what to do next, where each goal
stands, a log of what I've done, and a list of things I've tried.

## How it's built

Plain HTML, CSS and JavaScript, no framework and no build step, plus one small
server file for the AI chat.

| File | What it does |
| --- | --- |
| `index.html` | The page skeleton: Next up, Goals, Log, Tried, and the chat window |
| `style.css` | How it looks, including phone layout and dark mode |
| `app.js` | Reads `data.json` and draws everything |
| `data.json` | All the content. To update the dashboard, edit this file and nothing else |
| `api/chat.js` | The chat's server piece: it passes your messages to Claude and keeps the API key secret |
| `package.json` | Tells Vercel to install the Anthropic library that `api/chat.js` uses |

Ticking tasks, reordering Next up and accepting chat suggestions all work, but
only until you reload the page.

## Real AI chat

"Talk it through" sends your messages, plus what's on the dashboard right now,
to Claude (model `claude-haiku-5-5`, which costs about a twentieth of a cent
per message, so $5 of credit lasts thousands of chats). Claude answers and can suggest a change
(a new Next up task, a new target date, a new target number) that you Accept,
Edit or Skip.

The API key can't go in `app.js`: the site is public, and anyone can read a
page's JavaScript. So the key lives on a small server, `api/chat.js`, which runs
on Vercel for free. The page talks to that server, and only the server talks to
Claude.

### One-time setup (needs a parent for the accounts)

1. **Get an API key.** At https://console.anthropic.com create an API key and
   add some credit. Under Limits, set a low monthly spend limit (like $10) so
   a mistake can't run up a bill. Keep the key private: don't paste it into
   a chat, a file in this repo, or a message.
2. **Put the server on Vercel.** At https://vercel.com sign in with GitHub,
   choose Add New > Project, and import `goal-dashboard`. Leave the settings
   as they are.
3. **Add the secrets.** In the Vercel project go to Settings > Environment
   Variables and add:
   - `ANTHROPIC_API_KEY`: the key from step 1.
   - `CHAT_PASSCODE`: any passcode you make up. The chat asks for it once per
     browser, so strangers who find the server can't use your credit.
   - `ALLOWED_ORIGIN` (only if the site isn't at https://flashdw.github.io):
     the address of the site that may use the chat.

   Then open Deployments and Redeploy so the server picks them up.
4. **Connect the GitHub Pages site.** `CHAT_API_URL` in `app.js` points at the
   Vercel project's main address (from Domains on the project page, not a
   single deploy's long address): https://goal-dashboard-one.vercel.app . That
   address also shows the whole dashboard with the chat working, so you can
   use either one.

### Trying the chat on your computer

`python -m http.server` only serves files, so the chat can't reach a server
there. To run the server too, install Node.js and the Vercel command line tool
(`npm i -g vercel`), run `vercel link` once, then `vercel env pull` (this copies
the secrets into a local `.env.local`, which git ignores) and `vercel dev`.
Open the address it prints.

### Run it on your computer

Browsers won't let a page opened straight from a file read `data.json`, so start
a tiny local web server in this folder (PowerShell or Git Bash):

```
python -m http.server 8000
```

Then open http://localhost:8000. Press Ctrl+C in the terminal to stop it.
To check the phone layout, open the browser's dev tools (F12) and turn on the
device toolbar (Ctrl+Shift+M).

### Editing data.json

- `goals`: one or more per area. Leave out `target` for a goal with no progress
  bar. `due` can be a date (`2027-01-03`), words
  (`Every week`), or `null`. Optional extras: `"repeats": "weekly"` for a goal
  that resets each week, `steps` (shown as a checklist, with the first `done`
  of them ticked) and `recipePicks`.
- `next`: the order is the priority order. Move a line up or down to change it.
- `log`: date, goal id, one sentence.
- `tried`: `status` is `done`, `keeping` or `ruled out`.
