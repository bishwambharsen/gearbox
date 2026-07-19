import type { LedgerEntry, ModelTier } from '../types.js';
import { TIER_ORDER } from '../types.js';

export interface TierReportRow {
  tier: ModelTier;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
}

export interface ReportSummary {
  rows: TierReportRow[];
  totalActualUsd: number;
  totalBaselineUsd: number;
  savingsUsd: number;
  /** null when there's no baseline cost to compare against (empty/all-zero-usage ledger) */
  savingsPct: number | null;
}

export function filterBySession(entries: LedgerEntry[], sessionId?: string): LedgerEntry[] {
  if (!sessionId) return entries;
  return entries.filter((e) => e.sessionId === sessionId);
}

/** Pure aggregation over ledger entries: per-tier rows plus cumulative totals/savings. */
export function aggregate(entries: LedgerEntry[]): ReportSummary {
  const rowsByTier = new Map<ModelTier, TierReportRow>();
  let totalActualUsd = 0;
  let totalBaselineUsd = 0;

  for (const entry of entries) {
    const tier = entry.decision.tier;
    const row = rowsByTier.get(tier) ?? { tier, requests: 0, inputTokens: 0, outputTokens: 0, actualCostUsd: 0 };
    row.requests += 1;
    row.inputTokens += entry.usage.input_tokens ?? 0;
    row.outputTokens += entry.usage.output_tokens ?? 0;
    row.actualCostUsd += entry.actualCostUsd;
    rowsByTier.set(tier, row);

    totalActualUsd += entry.actualCostUsd;
    totalBaselineUsd += entry.baselineCostUsd;
  }

  const rows = TIER_ORDER.map((t) => rowsByTier.get(t)).filter((r): r is TierReportRow => r !== undefined);
  const savingsUsd = totalBaselineUsd - totalActualUsd;
  const savingsPct = totalBaselineUsd > 0 ? (savingsUsd / totalBaselineUsd) * 100 : null;

  return { rows, totalActualUsd, totalBaselineUsd, savingsUsd, savingsPct };
}
