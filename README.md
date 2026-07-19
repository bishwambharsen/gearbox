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

## Status

Early development. Phase 1 targets Claude models only; local/free model support is planned once the ledger proves real savings. See [PLAN.md](PLAN.md) for the full architecture and roadmap.

## License

MIT
