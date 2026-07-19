// Workstream 2 — the routing policy. Pure decision logic keyed by session id;
// no I/O, timers, or network. See PLAN.md "Routing policy".
import type { GearboxConfig, ModelTier, RequestContext, RouteDecision, Router } from '../types.js';
import { isToolLoopContinuation, latestUserText, parseGearOverride } from './request.js';
import { capTier, classifyFreshTurn, hysteresisAllowsSwitch, tierIndex, upshiftCapped } from './rules.js';
import { SessionStore } from './session.js';

export function createRouter(config: GearboxConfig): Router {
  const store = new SessionStore(config.defaultTier);

  function decide(
    tier: ModelTier,
    rule: string,
    reason: string,
    switched: boolean,
  ): RouteDecision {
    return { tier, model: config.tiers[tier].modelId, switched, rule, reason };
  }

  return {
    route(ctx: RequestContext): RouteDecision {
      const state = store.get(ctx.sessionId);
      const current = state.gear;
      const text = latestUserText(ctx.body);
      const tokens = ctx.estimatedInputTokens;

      // 1a. Explicit override — always wins, bypasses hysteresis, not capped by maxTier.
      const override = parseGearOverride(text);
      if (override) {
        const switched = override !== current;
        state.gear = override;
        return decide(override, 'user-override', `explicit override !gear=${override}`, switched);
      }

      // 1b. Escalation — safety valve. Upshift one gear (capped at maxTier), reset count.
      if (state.failures >= config.routing.escalationFailureThreshold) {
        const target = upshiftCapped(current, config.maxTier);
        state.failures = 0;
        const switched = target !== current;
        state.gear = target;
        return decide(
          target,
          'escalation',
          `${config.routing.escalationFailureThreshold} consecutive failures → upshift`,
          switched,
        );
      }

      // 1c/1d. Candidate from structural signal.
      let candidate: ModelTier;
      let rule: string;
      let reason: string;
      if (isToolLoopContinuation(ctx.body)) {
        candidate = 'haiku';
        rule = 'tool-loop-downshift';
        reason = 'mechanical tool_result continuation → cheapest gear';
      } else {
        const h = classifyFreshTurn(text, config);
        // Cap here, not just in the classifier, so every heuristic (e.g.
        // debugging → opus) respects maxTier now that upshifts actually fire.
        candidate = capTier(h.tier, config.maxTier);
        rule = `heuristic:${h.name}`;
        reason = h.reason;
      }

      // 1c (guard). Long context: never drop below the current gear.
      if (tokens > config.routing.longContextThreshold && tierIndex(candidate) < tierIndex(current)) {
        candidate = current;
        rule = 'long-context-guard';
        reason = `context ${tokens} tokens > threshold → hold current gear`;
      }

      // Candidate equals current gear: nothing to switch, report the classifying rule.
      if (candidate === current) {
        return decide(current, rule, reason, false);
      }

      // 3. Cache-aware hysteresis — downshifts only. An upshift is quality-driven
      // (the heuristic that chose it IS the need signal) and by construction can
      // never pay for itself in savings, so the savings gate must not apply to it.
      // Natural-boundary gating is structural: every candidate above originates
      // from a tool-loop continuation or a fresh user turn.
      const isDownshift = tierIndex(candidate) < tierIndex(current);
      if (isDownshift && !hysteresisAllowsSwitch(config, current, candidate, tokens)) {
        return decide(
          current,
          'hysteresis-hold',
          `expected savings below ${config.routing.switchMarginUsd} margin → stay`,
          false,
        );
      }

      state.gear = candidate;
      return decide(candidate, rule, reason, true);
    },

    reportFailure(sessionId: string): void {
      store.get(sessionId).failures += 1;
    },

    reportSuccess(sessionId: string): void {
      store.get(sessionId).failures = 0;
    },
  };
}
