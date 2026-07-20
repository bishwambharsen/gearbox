import type { GearboxConfig, Ledger, LedgerEntry, RouteDecision, TierConfig, UsageBlock } from '../types.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** USD cost of `usage` priced against a single tier's rates. */
function costUsd(usage: UsageBlock, tier: TierConfig): number {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  const micros =
    input * tier.inputPrice +
    output * tier.outputPrice +
    cacheRead * tier.inputPrice * tier.cacheReadMultiplier +
    cacheCreate * tier.inputPrice * tier.cacheWriteMultiplier;
  return micros / 1e6;
}

/** Fallback tier to price the counterfactual baseline against when the request's original
 * model matches no configured tier: the tier matching `baselineModel`'s modelId, or — if
 * that matches nothing either — the most expensive tier (by outputPrice, tie-broken by
 * inputPrice), so the baseline never silently understates cost. */
function fallbackBaselineTier(config: GearboxConfig): TierConfig {
  const tiers = Object.values(config.tiers);
  const match = tiers.find((t) => t.modelId === config.baselineModel);
  if (match) return match;
  return tiers.reduce((max, t) => {
    if (t.outputPrice > max.outputPrice) return t;
    if (t.outputPrice === max.outputPrice && t.inputPrice > max.inputPrice) return t;
    return max;
  });
}

export function createLedger(config: GearboxConfig): Ledger {
  const fallbackBaseline = fallbackBaselineTier(config);

  return {
    record(sessionId: string, decision: RouteDecision, usage: UsageBlock, originalModel: string) {
      const tier = config.tiers[decision.tier];
      // The true per-request counterfactual is the model the client originally requested.
      const baseline =
        Object.values(config.tiers).find((t) => t.modelId === originalModel) ?? fallbackBaseline;
      const entry: LedgerEntry = {
        timestamp: new Date().toISOString(),
        sessionId,
        originalModel,
        decision,
        usage,
        actualCostUsd: costUsd(usage, tier),
        baselineCostUsd: costUsd(usage, baseline),
      };

      const dir = dirname(config.ledgerPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // Synchronous + append-only so concurrent requests never interleave or reorder entries.
      appendFileSync(config.ledgerPath, JSON.stringify(entry) + '\n');
    },
  };
}

/** Reads all ledger entries from `path`. Missing file → []. Malformed lines are skipped. */
export function readLedger(path: string): LedgerEntry[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const entries: LedgerEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      entries.push(JSON.parse(line) as LedgerEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}
