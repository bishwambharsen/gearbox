# The `/gearbox` skill — task-level routing

The Gearbox proxy shifts every **API request** to the cheapest capable Claude model, but it only works for local sessions that point `ANTHROPIC_BASE_URL` at the proxy. The `/gearbox` skill is the second surface: it routes at the **task level**, needs no proxy, and works anywhere Claude Code runs — including cloud sessions at claude.ai/code and Claude Code on web/mobile.

| | Proxy | Skill |
|---|---|---|
| Level | Request | Task |
| Where | Local sessions only | Anywhere Claude Code runs |
| Setup | `ANTHROPIC_BASE_URL` + running proxy | Drop the skill in, invoke `/gearbox` |
| Mechanism | Rewrites the `model` field on the stream | Delegates subtasks to cheaper subagents |

## What it does

When you invoke `/gearbox` (or ask to "right-size", "save quota/tokens", or "route this to cheaper models"), the session model becomes an orchestrator. It decomposes your task, classifies each subtask on the same gear ladder the proxy uses, and delegates the cheap-enough pieces to cheaper Claude models through Claude Code's Agent tool — keeping the hard reasoning (architecture, review, synthesis) for itself. It reviews every result, escalates one gear on failure, and ends with a shift ledger showing which gear did what.

This works because the Agent tool accepts a per-subagent `model` override. An expensive session model can farm mechanical work out to haiku and routine work to sonnet, so your plan quota is spent only where it buys reasoning.

## Install

**Recommended — as a plugin from the marketplace** (this repo is its own Claude Code plugin marketplace). Inside any Claude Code session:

```
/plugin marketplace add bishwambharsen/gearbox
/plugin install gearbox@gearbox
```

The skill is then available in every session as `/gearbox:gearbox`, and `/plugin marketplace update` pulls new versions. This works in local and cloud sessions alike.

**Manual alternative** — copy the `skills/gearbox/` directory to one of two places:

- **For all your local sessions:** copy it to `~/.claude/skills/gearbox/`.

  ```bash
  cp -R skills/gearbox ~/.claude/skills/gearbox
  ```

- **To make it travel with a repo into cloud sessions** (recommended for claude.ai/code): copy it into the repo's `.claude/skills/` and commit it. It then rides along whenever that repo is opened in a cloud/web/mobile session — no local setup required.

  ```bash
  cp -R skills/gearbox <your-repo>/.claude/skills/gearbox
  ```

## Usage

```
/gearbox <your task>
/gearbox !gear=sonnet <task>   # pin: delegate all delegable work to sonnet
/gearbox !gear=session <task>  # pin: no delegation, do it all inline
```

## Caveat

The subagent model names (`haiku`, `sonnet`, `opus`) are **Claude Code aliases**, not the pinned model IDs in the proxy's config — Claude Code maps them to its current models. The gear-4 tier is not a subagent: it means the **orchestrator itself**, which runs on whatever model the session uses (your plan's session model in the cloud, or your local model). So the skill's savings come entirely from what it delegates down, not from changing the orchestrator.
