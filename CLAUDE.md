# goal-dashboard

Notes for Claude Code when working in this repo.

## Project

A goal-tracking dashboard in plain HTML, CSS and JavaScript (no framework, no build step): `index.html`, `style.css`, `app.js`, with all content in `data.json`. The "Talk it through" chat calls Claude through `api/chat.js`, a Vercel serverless function that keeps the API key server-side; never put a key in browser code. See README.md for setup and running locally.

## Environment

- Windows 11, PowerShell. Git Bash is also available.
- GitHub repo: FlashDW/goal-dashboard (private). The default branch is `main`.

## Working style

- Explain what you're doing in plain language. I'm getting started with this setup.
- Work on a branch for anything non-trivial and open a pull request instead of pushing straight to `main`.
- Never commit secrets. They go in `.env`, which git ignores.
