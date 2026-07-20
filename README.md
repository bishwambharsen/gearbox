# Gearbox

**An automatic transmission for Claude models.**

Gearbox stops you from burning your most expensive model quota on `git status`, and from grinding through a system-wide refactor on your cheapest one. It watches every request Claude Code makes and shifts it — automatically, mid-session, with no manual model switching — to the cheapest Claude tier that can actually do the job. A savings ledger then proves, in dollars, how much that saved you versus running everything on your usual model.

It ships two ways to get this, depending on where your session runs:

- **The proxy** — a local server that rewrites API requests in flight. Transparent, zero-effort, works with any Claude Code session on your machine.
- **The `/gearbox` skill** — a Claude Code plugin that routes at the task level by delegating subtasks to cheaper subagents. Works anywhere Claude Code runs, including cloud sessions where there's no local proxy to sit in front of.

Both are free and open source (MIT). Phase 1 targets Claude models only — local/free-model support is planned once the ledger proves the savings case (it has: see [Results](#results-so-far)).

---

## Table of contents

- [How the proxy works](#how-the-proxy-works)
- [Quickstart](#quickstart)
- [The gear ladder](#the-gear-ladder)
- [Routing policy](#routing-policy)
- [The cost ledger](#the-cost-ledger)
- [CLI reference](#cli-reference)
- [Running as a background service](#running-as-a-background-service)
- [The `/gearbox` skill](#the-gearbox-skill)
- [Configuration](#configuration)
- [Results so far](#results-so-far)
- [Why not LiteLLM / OpenRouter / an AI gateway?](#why-not-litellm--openrouter--an-ai-gateway)
- [Architecture](#architecture)
- [Contributing](#contributing)

---

## How the proxy works

Claude Code talks to `api.anthropic.com` over the Messages API. Point it at Gearbox instead, via the standard `ANTHROPIC_BASE_URL` environment variable, and every request passes through this pipeline before it reaches Anthropic:

```
Claude Code ──ANTHROPIC_BASE_URL──▶ Gearbox (localhost) ──▶ api.anthropic.com
                                      │
                                      ├─ classifies the request (pure rules, ~0ms, no LLM call)
                                      ├─ rewrites the `model` field to the chosen gear
                                      ├─ cache-aware: won't switch when prompt-cache
                                      │  re-warm cost would eat the savings
                                      ├─ falls back to your original model if the
                                      │  rewrite is rejected upstream — sessions never break
                                      └─ records real usage + cost to a savings ledger
```

Everything else — headers (including your OAuth/API-key auth), streaming, tool calls, the conversation itself — passes through untouched. Gearbox only ever touches the `model` field and reads the `usage` block off the response. This is deliberate: the less surface area a proxy touches, the less it can break when Anthropic changes something.

## Quickstart

```bash
git clone https://github.com/bishwambharsen/gearbox.git
cd gearbox
npm install
npm run dev              # starts the proxy on localhost:8484
```

In a separate terminal:

```bash
ANTHROPIC_BASE_URL=http://localhost:8484 claude
```

Use Claude Code normally. When you want to see what happened:

```bash
npx tsx src/cli.ts report          # or `gearbox report` once built — see CLI reference
```

No configuration is required to start — Gearbox ships with sensible defaults for every model, price, and threshold. See [Configuration](#configuration) to change any of them.

## The gear ladder

| Gear | Model | Used for |
|------|-------|----------|
| 1 | Haiku 4.5 | mechanical tool-loop continuations, trivial edits, housekeeping ("run the tests", "commit this") |
| 2 | Sonnet 5 | routine, well-specified coding — the default gear |
| 3 | Opus 4.8 | debugging, multi-file refactors, subtle logic |
| 4 | Fable 5 | architecture, planning, and the hardest reasoning |

Every model ID and price is config, not hardcoded — swap in whatever tiers your account has access to.

## Routing policy

Gearbox never calls an LLM to decide what to do with your request — classification is pure, deterministic rules, evaluated in order, so routing adds no latency:

1. **Explicit override.** Put `!gear=<tier>` anywhere in your message and Gearbox pins that tier for the request, no questions asked.
2. **Escalation.** After N consecutive failures on a session (tool calls erroring, retries), Gearbox upshifts one gear automatically — a safety valve so a downshifted model doesn't get stuck failing.
3. **Long-context guard.** Above a configurable token threshold, Gearbox never downshifts — big contexts stay on a model that can actually hold them.
4. **Tool-loop detection.** If the latest message is just a tool result with no new text from you, that's a mechanical continuation of an agent loop — a strong downshift signal.
5. **Heuristic classification.** A fresh message from you is scored on its content: planning/architecture language routes up, debugging/error language routes to the middle gear, short imperative housekeeping routes down, everything else stays at the default gear.
6. **Cache-aware hysteresis — the core of the design.** Anthropic's prompt cache is *per model*. Switch models and you throw the cache away, paying full price to rebuild it on the new model. So Gearbox's downshifts are gated: a downshift only happens when the expected savings exceed the cache re-warm cost plus a safety margin. Otherwise it holds the current gear rather than switching at a loss. **Upshifts are not gated this way** — they're driven by a quality signal (the classifier decided the task needs more reasoning), and a quality-driven switch shouldn't be vetoed by a savings calculation that, by construction, always looks unfavorable for spending more.

If a rewritten model is rejected upstream for any reason, the proxy retries once on your original model automatically — your session never breaks because of a routing decision. Rate limits (429) are never treated as a rejection; they pass straight through so Claude Code's own retry logic handles them.

## The cost ledger

Every request that completes gets one line in `~/.gearbox/ledger.jsonl`, recording:

- which gear it ran on, and why (the routing rule that fired)
- actual token usage, including cache reads/writes
- the actual cost, priced from that gear's config
- **the counterfactual cost** — what the same usage would have cost on the model Claude Code originally asked for, priced from the *same request*, not a static baseline

That per-request counterfactual is what makes the ledger trustworthy: aggregate reports don't get muddied by mixing sessions that have different default models, and a request that fell back to its original model correctly shows zero savings rather than a phantom loss.

## CLI reference

```
gearbox start                          Start the proxy server
gearbox report [--session id] [--last] Print the cost/savings ledger report
gearbox config                         Print the effective config as JSON
gearbox service install|status|uninstall
                                        Manage the macOS background service
```

`gearbox report` prints a per-gear breakdown (requests, tokens, actual cost) plus totals: actual spend, counterfactual baseline, and savings in dollars and percent. `--last` scopes to your most recent session; `--session <id>` scopes to a specific one.

## Running as a background service

On macOS, Gearbox can run as a `launchd` agent so it starts at login and restarts if it crashes — no terminal window required:

```bash
npm run build
npx gearbox service install     # writes the plist, loads it
npx gearbox service status      # check it's running
npx gearbox service uninstall   # remove it
```

Logs land in `~/.gearbox/logs/`. See [docs/daily-driver.md](docs/daily-driver.md) for the full setup, including a shell alias so `claude` routes through Gearbox automatically without exporting `ANTHROPIC_BASE_URL` in every session.

## The `/gearbox` skill

The proxy only helps when your session runs on a machine where the proxy is reachable — it can't see traffic from a cloud session at claude.ai/code, since that traffic never touches your local network. The `/gearbox` skill covers that gap by routing at the **task** level instead of the request level: the session model becomes an orchestrator, decomposes your task using the same gear-ladder logic the proxy uses, and delegates the cheap-enough pieces to cheaper Claude subagents via Claude Code's Agent tool — keeping architecture, review, and synthesis for itself. It ends every run with a shift ledger showing which gear did what, the skill's analog of `gearbox report`.

This repo is its own Claude Code plugin marketplace, so installing it takes two commands in any Claude Code session — local or cloud:

```
/plugin marketplace add bishwambharsen/gearbox
/plugin install gearbox@gearbox
```

Then just invoke it:

```
/gearbox <your task>
/gearbox !gear=sonnet <task>    # pin: delegate everything delegable to sonnet
/gearbox !gear=session <task>   # pin: no delegation, do it all yourself
```

See [docs/skill.md](docs/skill.md) for the proxy-vs-skill comparison and manual install instructions.

## Configuration

Gearbox works with zero configuration. To override model IDs, pricing, the proxy port, routing thresholds, or the savings baseline, drop a partial JSON file at `~/.gearbox/config.json` (or point `GEARBOX_CONFIG` at a path) — it's deep-merged over the defaults, so you only need to specify what you're changing. Full schema and examples in [docs/config.md](docs/config.md).

## Results so far

From real Claude Code sessions routed through Gearbox during development (see the ledger's own receipts — this isn't a synthetic benchmark):

- Model rewriting works transparently through Claude subscription (OAuth) auth, not just API keys.
- A session with a mix of routine coding and housekeeping requests saved **23.9%** versus running everything on the top-tier model, with the fallback safety net never triggering once the routing bugs found in early testing were fixed.
- Every failure mode encountered in testing — an incompatible beta header, a rate limit misclassified as a model rejection, a "thinking enabled" signal that over-triggered the top gear — was root-caused from the ledger and fixed. Nothing here is speculative; it's running against real traffic.

## Why not LiteLLM / OpenRouter / an AI gateway?

Fair question — model routing is a crowded category. LiteLLM, OpenRouter, Portkey, Martian, NotDiamond, and Vercel's AI Gateway are all **API gateways for developers building applications**: you bring API keys, they route across providers, and their unit of optimization is your API bill. Gearbox occupies a niche none of them touch:

- **It rides a Claude subscription, not an API key.** Gearbox proxies your existing Claude Code session — OAuth and all — so the thing it saves is your *plan quota*. The incumbents structurally can't do this: they terminate your API key at their gateway. If you're a subscription developer whose top-tier allowance keeps running out, no gateway helps you; Gearbox is built for exactly that.
- **It's cache-aware where it counts.** Anthropic prompt caches are per-model, so a router that flip-flops models destroys the cache and can cost *more* than no router at all. Generic routers don't model this; Gearbox's hysteresis treats cache re-warm cost as a first-class term in every switch decision. This is the part "easy to replicate" glosses over.
- **It understands agent-loop structure, not just prompt text.** Gateways classify by prompt content. Gearbox classifies by *conversation structure* — tool-loop continuations vs. fresh user turns, escalation on repeated failures, long-context guards — the signals that actually predict task complexity inside a coding agent's loop.
- **It proves itself with a counterfactual ledger.** Every session gets a receipts-attached answer to "what would this have cost on my usual model?" — measured on your real traffic, not a benchmark.

And an honest concession: if you need multi-provider routing for an app you're building, use LiteLLM — that's its job. Gearbox is not a gateway; it's a **quota optimizer for agentic Claude sessions**, and it deliberately starts single-provider because that's where the unsolved problems (per-model caches, OAuth passthrough, agent-loop signals) live.

## Architecture

Zero runtime dependencies — Node 22 built-ins only (`node:http`, `fetch`). TypeScript throughout, strict mode.

```
src/
  proxy/     HTTP server: SSE streaming passthrough, header forwarding,
             model rewrite, usage extraction, one-shot fallback retry
  router/    Pure routing policy — no I/O. Rules, hysteresis, per-session
             state, escalation.
  ledger/    JSONL cost ledger + report aggregation
  config/    Defaults + user config loading/validation
  service/   launchd plist generation and install/uninstall/status
  cli.ts     `gearbox` command
skills/gearbox/
  SKILL.md   The task-level orchestrator skill
```

See [PLAN.md](PLAN.md) for the full design rationale, milestones, and module contracts.

## Contributing

Issues and PRs welcome. The test suite (`npm test`) and typecheck (`npm run typecheck`) must pass. If you're proposing a routing-policy change, include the reasoning — the policy in `src/router/` is deliberately documented inline because every branch encodes a decision about what predicts task complexity, and those decisions should be arguable, not just asserted.

## License

MIT
