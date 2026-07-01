# slack-claude-agent

Self-hosted Slack bot that lets you @mention Claude in any thread and get streaming replies, interactive question cards, and plan approval gating before it can touch your files. One Claude Agent SDK session per thread, running entirely on your own machine and workspace, with no third-party service in the middle.

Think of it as a simple, solo, self-hosted take on the idea behind [Claude in Slack](https://www.anthropic.com/news/introducing-claude-tag). You bring your own machine, your own Anthropic credentials, and one project directory. The bot does the rest.

## What it does

* You @mention the bot in a channel. It opens a Claude session for that thread and streams the reply back into a single live-updating Slack message.
* Follow-up replies in the same thread continue the conversation with no re-mention needed. Each thread keeps its own Claude session, and sessions survive restarts.
* When Claude needs a decision, its questions render as native Slack radio or checkbox cards. Your selection resumes the thread.
* When Claude wants to change files, it must present a plan first. Write tools stay locked until you press **Approve** in Slack. You can also press **Request changes** to send feedback.
* Prefix a message with `plan:` to explicitly ask for a plan before any action.

## What it does NOT do

* It does not run in Anthropic's cloud. It runs on your host, against one directory you choose.
* It does not post Claude's internal tool calls (Read, Bash, Edit, and so on) into Slack. Those are tracked internally for permission gating but never surfaced.
* It does not use Socket Mode. It listens over HTTP and expects a tunnel in front of it.

## Security model

Read this before you install. This tool runs the Claude Agent SDK on your host with real filesystem and shell access to the workspace directory you configure, driven by Slack messages. **Anyone who can post in a channel the bot is in can task an autonomous agent on your machine.** There is no per-user authorization. Channel membership is the access control.

How the permission gate actually works, straight from the code:

* Read tools (Read, Glob, Grep, WebSearch, WebFetch, TodoWrite) run automatically and unattended.
* A small allowlist of read-only Bash commands (things like `find`, `ls`, `cat`, `grep`, `git log`, `curl`) also runs automatically. Treat this as a convenience heuristic, not a security boundary. Commands like `cat` and `curl` can read or send arbitrary data, and prefix based allowlisting is a known soft spot. It lowers friction. It does not make Bash safe.
* Write tools (Edit, MultiEdit, Write, NotebookEdit, and full Bash) are locked per thread until you approve a plan. Approval unlocks writes for that one thread only.
* Approval is coarse. Approving a plan unlocks all write tools for the rest of that thread. It is not a per-command confirmation. Review plans before approving. This is also your main defense against prompt injection from files the read tools ingest automatically.

Other things worth knowing:

* **Slack authenticity.** Inbound events are verified by the Slack Bolt library using your `SLACK_SIGNING_SECRET`. Unsigned or unexpected requests get a 404. The 404 is noise reduction, not authentication, so the port must be reachable only through your intended tunnel.
* **Never enable bypassPermissions.** Setting the SDK permission mode to `bypassPermissions` collapses the whole gate and lets writes run with no approval. The shipped code never enables it. Do not add it.
* **Settings inheritance.** The shipped default reads Claude settings, project `CLAUDE.md`, and MCP config from the `project` and `local` layers only. It deliberately skips your personal global `~/.claude` config. If you widen `settingSources` in `claude-slack.js` to include `user`, the agent will also inherit your global `CLAUDE.md` and any MCP credentials it references. Review before doing that.

Operator checklist:

* Run it as a low-privilege user, ideally inside a container or VM, scoped to one project directory. Not as root, and not on a box holding production credentials or SSH keys the agent should never see.
* Restrict channel membership. Being in the channel equals the ability to run the agent.
* There is no built-in rate limiting. Exposure is bounded only by who is in the channel.
* API usage bills to your Anthropic credentials. A busy or hostile channel is a cost vector.
* If your `.env` is ever exposed, rotate the Slack tokens immediately.

## Requirements

* Node.js 18 or newer.
* Claude Agent SDK authentication. Either a logged-in `claude` CLI on the host, or an `ANTHROPIC_API_KEY` in the process environment. The SDK spawns Claude as the user running this server, so that user must be authenticated.
* A Slack workspace where you can create and install an app.
* A public HTTPS tunnel to this server, for example [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) or [ngrok](https://ngrok.com/).

## Quick start

1. Clone and install.
   ```
   git clone <your-fork-url> slack-claude-agent
   cd slack-claude-agent
   npm install
   ```
2. Start a tunnel to the port you plan to use (default 3999) and copy the public HTTPS URL.
   ```
   cloudflared tunnel --url http://localhost:3999
   ```
3. Create the Slack app from the manifest. Go to [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App**, then **From a manifest**, and paste `slack-app-manifest.yaml`. Replace `REPLACE_ME.example.com` in it with your tunnel hostname first.
4. Set both request URLs to `https://<your-tunnel-host>/slack/events`. It goes in two places: **Event Subscriptions** and **Interactivity & Shortcuts**. People miss the Interactivity one, and then buttons do nothing.
5. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-...`) and the **Signing Secret**.
6. Configure the environment.
   ```
   cp .env.example .env
   ```
   Fill in `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `PORT`, and `PROJECT_WORKSPACE`.
7. Optional: customize the assistant's persona.
   ```
   cp prompt.example.md prompt.md
   ```
   Edit `prompt.md`. It is gitignored, so your version stays private.
8. Start the server.
   ```
   npm start
   ```
9. In Slack, invite the bot to a channel with `/invite @claude`, then mention it: `@claude what does this project do?`

## Configuration

All configuration is through environment variables (loaded from `.env`).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `SLACK_BOT_TOKEN` | yes | none | Bot User OAuth token (`xoxb-...`). |
| `SLACK_SIGNING_SECRET` | yes | none | Verifies that requests really come from Slack. |
| `PORT` | no | 3000 | HTTP port the server listens on. The `.env.example` uses 3999. |
| `PROJECT_WORKSPACE` | yes | current dir | Absolute path to the one directory the agent may read and write. `CLAUDE_WORKSPACE` also works and takes precedence. |
| `CLAUDE_MODEL` | no | `claude-sonnet-5` | Model id. `claude-opus-4-8` is the higher-quality upgrade. |
| `AGENT_PROMPT_FILE` | no | `./prompt.md` | Path to a custom system prompt file. Falls back to a built-in default if missing. |
| `CLAUDE_SETTING_SOURCES` | no | `project,local` | Which Claude settings layers the agent inherits. Add `user` to also inherit your global `~/.claude` config. See Security. |

Note: this app uses HTTP plus your signing secret. It does not use Socket Mode, so there is no `SLACK_APP_TOKEN` here by design.

## Customizing the system prompt

The bot appends a system prompt on top of the Claude Code preset. To change its persona or house rules, copy `prompt.example.md` to `prompt.md` and edit it. If neither `prompt.md` nor a file at `AGENT_PROMPT_FILE` exists, a built-in default is used and a warning is logged at boot. The prompt is read once at startup, so restart the server (or `pm2 restart slack-claude-agent`) after editing.

## Usage

| Action | How |
|---|---|
| Start a thread | `@claude <your question>` in a channel the bot is in. |
| Continue a thread | Just reply in the thread. No re-mention needed. |
| Ask for a plan first | Prefix with `plan:`, for example `plan: refactor the auth module`. |
| Approve changes | Press **Approve & proceed** on the plan card. This unlocks writes for that thread. |
| Send feedback on a plan | Press **Request changes** and type what should change. |
| Answer a question | Pick options on the card and press **Submit**. |

## Running in production

Use a process manager and a persistent tunnel.

```
pm2 start ecosystem.config.js
pm2 logs slack-claude-agent
pm2 restart slack-claude-agent
```

Run cloudflared or ngrok as a service (not an ad hoc terminal command) so the public URL stays stable. If the tunnel hostname changes, update both Slack request URLs.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Bot stays silent | It is not in the channel, or the `message.channels` event and `channels:history` scope are missing. |
| `url_verification` fails in Slack | Wrong `SLACK_SIGNING_SECRET`, or the tunnel is down. |
| Requests 404 | The request URL must end in `/slack/events`. |
| Buttons and cards do nothing | Interactivity request URL is not set. Set it to the same `/slack/events` URL. |
| Thread stops continuing after a restart | The thread is not in `thread_session_map.json`. Mention the bot again to start fresh. |

## How it works

```
Slack  ──(events over HTTPS)──►  tunnel  ──►  server.js (Bolt HTTP receiver)
                                                  │
                                                  ▼
                                          claude-slack.js
                                    (one Claude Agent SDK session
                                     per thread, streamed back to
                                     a single live Slack message)
```

`server.js` handles Slack wiring: mentions, thread replies, de-duplication of Slack's retries, and the `plan:` prefix. `claude-slack.js` is the bridge: it runs one Claude session per thread, serializes turns, gates tools, renders question and plan cards, and persists the thread-to-session map to `thread_session_map.json`.

## License

MIT. See [LICENSE](LICENSE).

## Contributing

Issues and pull requests are welcome. This is a small project meant to stay small and legible, so please keep changes focused and explain the trust or security impact of anything that touches the permission gate.
