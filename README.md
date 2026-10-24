# goal-dashboard

A one-page dashboard for my personal goals: what to do next, where each goal
stands, a log of what I've done, and a list of things I've tried.

## Version 1: clickable mockup

Plain HTML, CSS and JavaScript, no framework and no build step.

| File | What it does |
| --- | --- |
| `index.html` | The page skeleton: Next up, Goals, Log, Tried, and the chat window |
| `style.css` | How it looks, including phone layout and dark mode |
| `app.js` | Reads `data.json` and draws everything |
| `data.json` | All the content. To update the dashboard, edit this file and nothing else |

The "Talk it through" chat plays a scripted sample conversation (`sampleChat` in
`data.json`) instead of calling a real AI. Ticking tasks, reordering Next up and
accepting suggestions all work, but only until you reload the page.

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
  bar (like Fun and friends). `due` can be a date (`2027-01-03`) or words
  (`Every week`).
- `next`: the order is the priority order. Move a line up or down to change it.
- `log`: date, goal id, one sentence.
- `tried`: `status` is `done`, `keeping` or `ruled out`.
