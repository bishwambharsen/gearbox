// STUB — Workstream 2 replaces the body; keep the exported signature.
import type { GearboxConfig, RequestContext, RouteDecision, Router } from '../types.js';

export function createRouter(config: GearboxConfig): Router {
  return {
    route(_ctx: RequestContext): RouteDecision {
      const tier = config.defaultTier;
      return {
        tier,
        model: config.tiers[tier].modelId,
        switched: false,
        rule: 'stub-default',
        reason: 'stub router: always default tier',
      };
    },
    reportFailure() {},
    reportSuccess() {},
  };
}
