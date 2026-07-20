# Gearbox

**An automatic transmission for Claude models.**

Gearbox is a local-first proxy that sits between your coding agent (Claude Code) and the Anthropic API. It classifies every request in real time and shifts it to the cheapest Claude model that can handle it — so you never redline Fable 5 on a `git status`, and never grind through an architecture refactor on Haiku.

```
Claude Code ──ANTHROPIC_BASE_URL──▶ Gearbox (localhost) ──▶ api.anthropic.com
                                      │
                                      ├─ classifies each request (rules, ~0ms)
                                      ├─ rewrites `model` to the right gear
                                      ├─ cache-aware: won't switch when the
                                      │  prompt-cache re-warm cost eats the savings
                                      └─ ledger: proves $ saved vs. single-model baseline
```

## The gears

| Gear | Model | Used for |
|------|-------|----------|
| 1 | Haiku 4.5 | mechanical tool loops, trivial edits |
| 2 | Sonnet 5 | routine coding (default) |
| 3 | Opus 4.8 | refactors, debugging, design |
| 4 | Fable 5 | architecture & hardest reasoning |

## Quickstart

```bash
npm install
npm run dev          # starts the proxy on localhost:8484
# in another shell:
ANTHROPIC_BASE_URL=http://localhost:8484 claude
# later:
npx gearbox report   # tokens & $ saved this session
```

Gearbox works with zero configuration. To change ports, model IDs, pricing, routing thresholds, or the savings baseline, see [docs/config.md](docs/config.md).

## Why not LiteLLM / OpenRouter / an AI gateway?

Fair question — model routing is a crowded category. LiteLLM, OpenRouter, Portkey, Martian, NotDiamond, and Vercel's AI Gateway are all **API gateways for developers building applications**: you bring API keys, they route across providers, and their unit of optimization is your API bill. Gearbox occupies a niche none of them touch:

- **It rides a Claude subscription, not an API key.** Gearbox proxies your existing Claude Code session — OAuth and all — so the thing it saves is your *plan quota*. The incumbents structurally can't do this: they terminate your API key at their gateway. If you're a Max-plan developer whose Fable/Opus allowance keeps running out, no gateway helps you; Gearbox is built for exactly that.
- **It's cache-aware where it counts.** Anthropic prompt caches are per-model, so a router that flip-flops models destroys the cache and can cost *more* than no router. Generic routers don't model this; Gearbox's hysteresis treats cache re-warm cost as a first-class term in every switch decision. This is the part "easy to replicate" glosses over.
- **It understands agent-loop structure, not just prompt text.** Gateways classify by prompt content. Gearbox classifies by *conversation structure* — tool-loop continuations vs. fresh user turns, escalation on repeated failures, long-context guards — the signals that actually predict task complexity inside a coding agent's loop.
- **It proves itself with a counterfactual ledger.** Every session gets a receipts-attached answer to "what would this have cost on my usual model?" — measured on your real traffic, not a benchmark.

And an honest concession: if you need multi-provider routing for an app you're building, use LiteLLM — that's its job. Gearbox is not a gateway; it's a **quota optimizer for agentic Claude sessions**, and it deliberately starts single-provider because that's where the unsolved problems (per-model caches, OAuth passthrough, agent-loop signals) live.

## Status

Early development. Phase 1 targets Claude models only; local/free model support is planned once the ledger proves real savings. See [PLAN.md](PLAN.md) for the full architecture and roadmap.

## License

MIT
