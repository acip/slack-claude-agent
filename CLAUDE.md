# slack-claude-agent

A self-hosted bridge that lets you @mention Claude in Slack threads. See README.md
for the full picture, and the Security section there before changing anything that
touches the permission gate.

## Layout

* `server.js`: Slack Bolt HTTP receiver. Handles app_mention and thread replies,
  strips the mention, de-dupes Slack retries, and supports a `plan:` prefix.
* `claude-slack.js`: the bridge. One Claude Agent SDK session per thread, per-thread
  serialization, tool gating, question and plan cards, streaming into one live
  Slack message, and session persistence.
* `thread_session_map.json`: runtime state mapping Slack thread timestamps to Claude
  session ids. Gitignored. Do not commit it.
* `prompt.md`: optional local system prompt. Gitignored. Copy from `prompt.example.md`.

## Process management

If you run under pm2, restart to apply changes (this also reloads `prompt.md`, which
is read once at boot):

```
pm2 restart slack-claude-agent
pm2 logs slack-claude-agent --lines 50 --nostream
```

Without pm2, `npm start` runs the server directly.

## Design notes

* Tool calls are never surfaced in Slack. Claude's internal tool usage (Read, Bash,
  Edit, and so on) is tracked in memory for permission gating but nothing is posted.
* HTTP webhook mode only. A tunnel (cloudflared or ngrok) proxies inbound Slack
  events to the local port. Do not switch to Socket Mode; the tunnel needs a local
  HTTP listener.
* Session ids persist in `thread_session_map.json` so threads survive restarts.
* Write tools (Edit, Write, Bash) stay locked per thread until a plan is approved via
  the Approve button in Slack. Keep that gate intact.
