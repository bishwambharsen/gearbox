# Running Gearbox as a daily driver

`npm run dev` is fine for trying Gearbox out, but it dies the moment you close the terminal. This page covers running it as a background service on macOS — via `launchd` — so it starts on login, restarts if it crashes, and stays out of your way.

This is macOS-only. `launchd` is a macOS concept; there's no Linux/Windows service support yet.

## Install as a background service

Build first — the service runs the compiled `dist/cli.js`, not the TypeScript source:

```bash
npm run build
```

Then install and start the launchd agent:

```bash
gearbox service install
```

This writes a launch agent plist to `~/Library/LaunchAgents/com.gearbox.proxy.plist` and loads it immediately, so the proxy is already running on `localhost:8484` (or whatever port your config sets). It also configures the agent to:

- start automatically on login (`RunAtLoad`)
- restart automatically if the process dies (`KeepAlive`)
- write logs to `~/.gearbox/logs/`

If `dist/cli.js` doesn't exist yet, `gearbox service install` fails with a reminder to run `npm run build` — it never silently installs a stale or missing build.

## Check status and logs

```bash
gearbox service status
```

Reports whether the agent is installed and, if so, whether it's currently running (with its PID). Under the hood this is a thin wrapper around:

```bash
launchctl list com.gearbox.proxy
```

For the actual proxy output — request logs, routing decisions, errors — tail the log files directly:

```bash
tail -f ~/.gearbox/logs/gearbox.log       # stdout
tail -f ~/.gearbox/logs/gearbox.err.log   # stderr
```

## Uninstall

```bash
gearbox service uninstall
```

Unloads the launch agent and deletes the plist. This does not touch your config (`~/.gearbox/config.json`) or ledger (`~/.gearbox/ledger.jsonl`) — those persist so you can reinstall later without losing history.

## Pointing Claude Code at the service: the `gclaude` alias

Once the service is running, Claude Code needs `ANTHROPIC_BASE_URL` set to `http://localhost:8484` to route through it. The recommended way to do this is a shell alias, **not** a global setting — see the warning below.

Add this to `~/.zshrc`:

```bash
alias gclaude='ANTHROPIC_BASE_URL=http://localhost:8484 claude'
```

Reload your shell (`source ~/.zshrc` or open a new tab), then start Claude Code with:

```bash
gclaude
```

Only that invocation talks to Gearbox. Plain `claude` still goes straight to `api.anthropic.com`, so you always have an escape hatch if the proxy is misbehaving.

## Warning: don't set `ANTHROPIC_BASE_URL` globally until you trust the service

It's tempting to set `ANTHROPIC_BASE_URL` once in `~/.claude/settings.json` so every `claude` invocation is routed automatically. Resist this until you've run Gearbox as a daily driver for a while:

- If the Gearbox service isn't running — crashed, machine just rebooted before `RunAtLoad` kicked in, uninstalled, port conflict — **every** `claude` session fails to start, with no fallback. There's no local model behind it; Gearbox only forwards to `api.anthropic.com`, so a down proxy means a down Claude Code, full stop.
- The `gclaude` alias keeps plain `claude` working at all times, so a Gearbox outage costs you nothing — you just lose routing/savings for that session, not access entirely.

Once you're confident the service reliably survives reboots and crashes (check `gearbox service status` after a restart a few times), promoting `ANTHROPIC_BASE_URL` to `~/.claude/settings.json` is reasonable. Until then, prefer the alias.

## Troubleshooting

- **`gearbox service status` shows "not installed"** — you haven't run `gearbox service install` yet, or a prior uninstall removed it.
- **Installed but not running** — check `~/.gearbox/logs/gearbox.err.log` for a startup error (bad config, port already in use are the common ones).
- **Config or pricing changes don't take effect** — the service only reads `~/.gearbox/config.json` at startup; reinstalling (`gearbox service uninstall && gearbox service install`) restarts it and picks up changes. See [config.md](config.md) for what's configurable.
