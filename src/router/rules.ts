// Pure classification + pricing math. No I/O, no session state.
import type { GearboxConfig, ModelTier } from '../types.js';
import { TIER_ORDER } from '../types.js';

export function tierIndex(tier: ModelTier): number {
  return TIER_ORDER.indexOf(tier);
}

/** Clamp a tier so it never exceeds `cap`. */
export function capTier(tier: ModelTier, cap: ModelTier): ModelTier {
  return tierIndex(tier) > tierIndex(cap) ? cap : tier;
}

/** One gear up, then clamped so it never exceeds `cap`. */
export function upshiftCapped(tier: ModelTier, cap: ModelTier): ModelTier {
  const next = TIER_ORDER[Math.min(tierIndex(tier) + 1, TIER_ORDER.length - 1)];
  return capTier(next, cap);
}

const PLANNING_RE = /\b(design(?:ing)?|architect(?:ure)?|plan(?:s|ning|ned)?|restructure)\b|refactor across/i;
const DEBUGGING_RE = /\b(bug|fix|error|traceback)\b|stack trace|failing test/i;
const HOUSEKEEPING_VERBS = new Set(['run', 'show', 'list', 'status', 'commit', 'rename']);
const SHORT_TEXT_MAX = 60;

export interface Heuristic {
  tier: ModelTier;
  /** Suffix for the "heuristic:<name>" rule id. */
  name: string;
  reason: string;
}

function isShortHousekeeping(text: string): boolean {
  if (text.length > SHORT_TEXT_MAX) return false;
  const firstWord = text.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, '') ?? '';
  return HOUSEKEEPING_VERBS.has(firstWord);
}

/**
 * Classify a fresh user turn. Order matters: planning wins over debugging,
 * which wins over housekeeping, which wins over the default gear. A request's
 * `thinking` flag is deliberately NOT a signal: Claude Code enables thinking
 * on nearly every request, so it carries no information about task complexity
 * (validated empirically — it routed whole sessions to the top gear).
 */
export function classifyFreshTurn(text: string, config: GearboxConfig): Heuristic {
  if (PLANNING_RE.test(text)) {
    return {
      tier: capTier('fable', config.maxTier),
      name: 'planning',
      reason: 'planning/architecture markers → hardest reasoning gear',
    };
  }
  if (DEBUGGING_RE.test(text)) {
    return { tier: 'opus', name: 'debugging', reason: 'error/debugging markers → high reasoning gear' };
  }
  if (isShortHousekeeping(text)) {
    return { tier: 'haiku', name: 'housekeeping', reason: 'short imperative housekeeping → cheapest gear' };
  }
  return { tier: config.defaultTier, name: 'default', reason: 'no strong signal → default gear' };
}

/**
 * Approximate USD saved by moving `tokens` of input from `current` to
 * `candidate`, minus a cache re-warm penalty (the target model starts cold, so
 * its input is billed at full rather than cache-read price). Upshifts yield a
 * negative number by construction, which is why the savings gate below is only
 * ever applied to downshifts — quality-driven upshifts bypass it.
 */
export function expectedSavingsUsd(
  config: GearboxConfig,
  current: ModelTier,
  candidate: ModelTier,
  tokens: number,
): number {
  const currentPrice = config.tiers[current].inputPrice;
  const candidatePrice = config.tiers[candidate].inputPrice;
  const candidateCacheRead = config.tiers[candidate].cacheReadMultiplier;
  const priceDelta = (tokens * (currentPrice - candidatePrice)) / 1e6;
  const rewarmPenalty = (tokens * candidatePrice * (1 - candidateCacheRead)) / 1e6;
  return priceDelta - rewarmPenalty;
}

export function hysteresisAllowsSwitch(
  config: GearboxConfig,
  current: ModelTier,
  candidate: ModelTier,
  tokens: number,
): boolean {
  return expectedSavingsUsd(config, current, candidate, tokens) > config.routing.switchMarginUsd;
}
