# Gearbox — Implementation Plan

**An automatic transmission for Claude models.** Gearbox is a local-first proxy that sits between a coding agent (Claude Code) and the Anthropic API. It classifies every request in real time and shifts it to the cheapest Claude model that can handle it — Haiku 4.5 for mechanical tool loops, Sonnet 5 for routine coding, Opus 4.8 for hard reasoning, Fable 5 only when the task truly demands it. It proves its value with a per-session cost ledger: tokens and dollars saved vs. a single-model baseline.

**Phase 1 scope (this plan): Claude models only.** Local/free model support is explicitly out of scope until savings are proven.

## Why this beats the /advisor pattern

- Not limited to 2 models — the full Claude ladder is available per request.
- No manual switching, no re-sent context: the proxy rewrites the `model` field on the same request stream.
- Cache-aware: Anthropic prompt caches are **per-model**, so naive switching destroys cache hits and can cost MORE than no router. Gearbox treats cache re-warm cost as a first-class term in every switch decision (hysteresis / sticky routing).

## Architecture

```
Claude Code ──ANTHROPIC_BASE_URL──▶ Gearbox proxy (localhost)
                                      │ 1. parse /v1/messages request
                                      │ 2. Router.route(ctx) → tier decision
                                      │ 3. rewrite `model`, forward to api.anthropic.com
                                      │ 4. stream response back (SSE passthrough)
                                      │ 5. Ledger.record(usage, decision)
                                      ▼
                              api.anthropic.com
```

Zero runtime dependencies. Node 22, TypeScript, `node:http` + `fetch`/`undici` built-ins only. Dev deps: typescript, tsx, vitest.

## Model ladder

| Gear | Model ID | Use for |
|------|----------|---------|
| 1 | `claude-haiku-4-5` | tool-result continuations, mechanical loops, trivial edits |
| 2 | `claude-sonnet-5` | routine coding, small features, default gear |
| 3 | `claude-opus-4-8` | multi-file refactors, debugging, design |
| 4 | `claude-fable-5` | architecture, planning, hardest reasoning (opt-in cap) |

All IDs and per-model pricing live in config — never hardcoded in logic.

## Routing policy (the core IP)

Tiered classifier, cheapest signal first. **No LLM calls for classification in Phase 1** — rules only, so routing adds near-zero latency.

1. **Structural rules (deterministic):**
   - Last message is a `tool_result` with no new user text → this is a continuation of a mechanical loop → downshift eligible.
   - New user turn (fresh human text) → re-classify from scratch.
   - Context length > threshold → force a tier that handles it well.
   - Request has `thinking` enabled or user text contains planning/architecture markers ("design", "architect", "refactor across", "plan") → upshift.
2. **Heuristic scoring:** user-text length, number of files referenced, presence of error/stack-trace text (debugging → gear 3), diff size mentioned.
3. **Hysteresis (cache-aware stickiness), downshifts only:** a downshift is only allowed when
   `expected_savings(stay→target) > cache_rewarm_cost + switch_margin`.
   Approximate `cache_rewarm_cost` as `cached_input_tokens × (input_price(target) − cache_read_price(current))`. Upshifts are quality-driven — the heuristic/escalation/override that chose them is the need signal — and can never pay for themselves in savings by construction, so the savings gate must not apply to them (heuristic upshifts are capped at `maxTier`). Prefer switching at natural boundaries: new user turn, post-compaction. Never mid tool-loop upshift unless an escalation trigger fires.
4. **Escalation triggers (safety valve):** N consecutive failed tool calls, repeated identical edits, or explicit user override header → upshift one gear immediately. Quality must never silently degrade.
5. **Overrides:** magic strings in user text (`!gear=fable`, `!gear=haiku`) and config-pinned tiers per session.

Every decision returns a `RouteDecision { model, tier, reason, rule, switched }` — reasons are logged so routing is auditable.

## Cost ledger

- Parse the `usage` block from every Anthropic response (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).
- Compute actual cost from config pricing (incl. cache read ≈ 0.1×, cache write ≈ 1.25×).
- Compute **counterfactual baseline**: what the same usage would have cost on a fixed pinned model (configurable, default the top gear the user normally runs).
- Append JSONL entries to `~/.gearbox/ledger.jsonl`.
- `gearbox report` CLI: per-session and cumulative table — requests per gear, tokens, actual $, baseline $, savings $ and %.

This ledger is the product's proof. It must be accurate before we scale to local models.

## Milestones

- **M0 — Passthrough spike (validation):** proxy forwards Claude Code traffic untouched (streaming works, auth header forwarded verbatim). Validates that `ANTHROPIC_BASE_URL` + model rewriting works with the user's auth mode. *Risk: subscription OAuth traffic may behave differently than API-key traffic — M0 answers this empirically.*
- **M1 — Static rewrite:** proxy rewrites `model` per config rules; ledger records usage.
- **M2 — Dynamic routing:** full rule classifier + hysteresis + escalation.
- **M3 — Report & polish:** `gearbox report`, README quickstart, config docs.

## Module contracts

All shared types live in `src/types.ts` (already written — code against it, do not redefine). Stub implementations exist in each module's `index.ts`; **replace the stub bodies, keep the exported factory signatures** so `src/index.ts` always compiles.

### Workstream 1 — `src/proxy/` (owner: Opus agent)
`createProxy(config, router, ledger): GearboxServer`. Node `http` server. Handles: POST `/v1/messages` (streaming SSE and non-streaming), all other paths transparent passthrough. Forwards all headers (esp. `authorization`, `x-api-key`, `anthropic-*`) verbatim except hop-by-hop. Rewrites `body.model` from `router.route()`. On upstream 4xx tied to a rewritten model (e.g. model not available), retry once with the original model and record the fallback. Extracts `usage` from responses — including from the final `message_delta` SSE event — and calls `ledger.record()`. Tests: header forwarding, SSE reassembly, usage extraction, fallback retry.

### Workstream 2 — `src/router/` (owner: Opus agent)
`createRouter(config): Router`. Pure decision logic, no I/O. Implements the routing policy above: structural rules → heuristics → hysteresis → escalation → overrides. Maintains per-session state (current gear, consecutive-failure count) keyed by `RequestContext.sessionId`. Every branch covered by unit tests with realistic Messages-API request fixtures.

### Workstream 3 — `src/config/` + `src/ledger/` + CLI (owner: Sonnet agent)
`loadConfig(path?)`: reads `~/.gearbox/config.json`, deep-merges over documented defaults (model IDs, pricing, thresholds, baseline model), validates shape, helpful errors. `createLedger(config): Ledger`: appends JSONL to `~/.gearbox/ledger.jsonl`, computes actual + counterfactual cost per entry. `src/cli.ts`: `gearbox start` (runs proxy), `gearbox report [--session id]` (savings table), `gearbox config` (print effective config). Tests: config merge/validation, cost math incl. cache multipliers, report aggregation.

### Ground rules for all workstreams
- Zero runtime dependencies. Do not edit `package.json`, `tsconfig.json`, or `src/types.ts` — if a contract seems wrong, note it in your final report instead.
- Only touch your own directory plus your tests in `test/<workstream>/`.
- `npx tsc --noEmit` and `npx vitest run` must pass before you finish.
- Match existing code style; comments only for non-obvious constraints.

## Risks

1. **Auth mode:** subscription (OAuth) vs API key behavior through a proxy — resolved empirically at M0.
2. **Cache invalidation on switch** — mitigated by hysteresis; ledger will expose if switching still nets negative.
3. **Downshifted model fumbles tool calls** — mitigated by escalation triggers + one-shot fallback retry in the proxy.
4. **Anthropic API surface drift** — passthrough-first design: we only touch `model` and read `usage`; everything else is forwarded opaquely.
