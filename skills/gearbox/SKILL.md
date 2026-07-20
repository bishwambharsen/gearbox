---
name: gearbox
description: "Use when the user invokes /gearbox, or asks to right-size a task, save quota/tokens/plan usage, or route work to cheaper models. Task-level automatic transmission: decompose a task, delegate right-sized subtasks to cheaper Claude subagents (haiku/sonnet/opus) via the Agent tool, keep the hard reasoning for yourself, and report the quota savings. Works anywhere Claude Code runs, including cloud sessions."
---

# gearbox

You are the orchestrator. Your job is to route each piece of work to the cheapest capable Claude model, keep the hard reasoning for yourself, and prove the savings. Being the orchestrator IS the top gear — do not delegate the orchestration.

## The gear ladder

Classify every subtask onto one gear. When a subtask matches more than one signal, the **highest gear wins** (precedence: gear 4 > gear 3 > gear 1 > gear 2 default).

- **Gear 1 — haiku (delegate).** Mechanical / housekeeping: running commands, renames, moving files, formatting, single-file boilerplate, mechanical find-and-replace, short well-bounded lookups.
- **Gear 2 — sonnet (delegate).** Routine, well-specified implementation with a clear contract: a defined function against a known signature, a self-contained component, a documented small feature.
- **Gear 3 — opus (delegate).** Debugging, multi-file refactors, subtle logic, tracing an error across the codebase, anything where the approach is uncertain.
- **Gear 4 — session model (do NOT delegate).** Architecture, task decomposition, reviewing subagent output, synthesizing results, final judgment. You do these yourself. The Agent `model` override only accepts `haiku | sonnet | opus` — there is no gear-4 subagent, so never try to spawn one.

## Protocol

1. **Decompose.** Break the user's task into subtasks. Classify each on the ladder above. Keep the gear-4 work (decomposition, review, synthesis) for yourself.

2. **Delegate gears 1–3** via the Agent tool, passing the matching `model` override (`haiku`, `sonnet`, or `opus`). Subagents start cold, so every prompt must be self-contained: exact file paths (absolute), the contract or expected output, ground rules, and the verification commands the subagent should run (typecheck/tests/lint). Run independent subtasks in parallel — issue those Agent calls in one batch.

3. **Batch, don't shred.** Many small related edits go to ONE subagent, not one subagent each. Per-spawn overhead is real (a cold subagent re-derives context you already have) — this is the task-level analog of the proxy's cache-rewarm cost, and it is why you group. Only split work across subagents when the pieces are genuinely independent or need different gears.

4. **Review at session level.** Read every subagent result yourself before accepting it. When code changed, verify with the project's own checks (typecheck, tests) — do not trust a subagent's self-report.

5. **Escalate on failure, exactly once.** If a subagent's output fails your review or its verification commands, re-run that subtask exactly **one gear up** (gear 1→2, 2→3, 3→you). At most one escalation per subtask; if it still fails after that, stop delegating it and handle it yourself. Delegation is the only downshift; escalation is the only upshift — upshifts are quality-driven and never justified by savings.

6. **Override.** If the user's request contains `!gear=<haiku|sonnet|opus|session>` anywhere, it is a hard pin for the whole task (no per-subtask classification, no escalation):
   - `!gear=haiku|sonnet|opus` — delegate **all** delegable work to that one tier, but still decompose, review, and report at session level (those are structurally the orchestrator's job).
   - `!gear=session` — do not delegate at all; do the entire task yourself inline.

7. **Report the shift ledger.** End your final reply with one line per subtask so the savings are visible:

   ```
   Shift ledger
   - [gear 1 · haiku]  <subtask> — accepted
   - [gear 2 · sonnet] <subtask> — escalated→gear 3, accepted
   - [gear 3 · opus]   <subtask> — accepted
   - [gear 4 · session] <subtask> — done inline (orchestration/review)
   ```

   Mark each subtask accepted, escalated (with the new gear), or done inline. This is the skill's analog of `gearbox report`.
