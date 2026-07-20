import type { LedgerEntry, ModelTier } from '../types.js';
import { TIER_ORDER } from '../types.js';

export interface TierReportRow {
  tier: ModelTier;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  actualCostUsd: number;
}

export interface SessionSummary {
  sessionId: string;
  firstTimestamp: string;
  lastTimestamp: string;
  requests: number;
  actualCostUsd: number;
  baselineCostUsd: number;
}

export interface ReportSummary {
  rows: TierReportRow[];
  totalActualUsd: number;
  totalBaselineUsd: number;
  savingsUsd: number;
  /** null when there's no baseline cost to compare against (empty/all-zero-usage ledger) */
  savingsPct: number | null;
  /** Count of entries the proxy bounced back to the original model after a rewrite was rejected. */
  fallbackRequests: number;
  /** Per-session rollup, sorted by lastTimestamp ascending. */
  sessions: SessionSummary[];
}

export function filterBySession(entries: LedgerEntry[], sessionId?: string): LedgerEntry[] {
  if (!sessionId) return entries;
  return entries.filter((e) => e.sessionId === sessionId);
}

/** Selects the entries belonging to the session with the most recent lastTimestamp. Empty in → empty out. */
export function selectLastSession(entries: LedgerEntry[]): LedgerEntry[] {
  const sessions = sessionSummaries(entries);
  const last = sessions[sessions.length - 1];
  if (!last) return [];
  return entries.filter((e) => e.sessionId === last.sessionId);
}

/** Per-session rollup, sorted by lastTimestamp ascending (ISO timestamps compare lexicographically). */
function sessionSummaries(entries: LedgerEntry[]): SessionSummary[] {
  const bySession = new Map<string, SessionSummary>();
  for (const entry of entries) {
    const s = bySession.get(entry.sessionId);
    if (!s) {
      bySession.set(entry.sessionId, {
        sessionId: entry.sessionId,
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        requests: 1,
        actualCostUsd: entry.actualCostUsd,
        baselineCostUsd: entry.baselineCostUsd,
      });
      continue;
    }
    if (entry.timestamp < s.firstTimestamp) s.firstTimestamp = entry.timestamp;
    if (entry.timestamp > s.lastTimestamp) s.lastTimestamp = entry.timestamp;
    s.requests += 1;
    s.actualCostUsd += entry.actualCostUsd;
    s.baselineCostUsd += entry.baselineCostUsd;
  }
  return [...bySession.values()].sort((a, b) => (a.lastTimestamp < b.lastTimestamp ? -1 : a.lastTimestamp > b.lastTimestamp ? 1 : 0));
}

/** Pure aggregation over ledger entries: per-tier rows plus cumulative totals/savings. */
export function aggregate(entries: LedgerEntry[]): ReportSummary {
  const rowsByTier = new Map<ModelTier, TierReportRow>();
  let totalActualUsd = 0;
  let totalBaselineUsd = 0;
  let fallbackRequests = 0;

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
    if (entry.decision.rule === 'proxy-fallback') fallbackRequests += 1;
  }

  const rows = TIER_ORDER.map((t) => rowsByTier.get(t)).filter((r): r is TierReportRow => r !== undefined);
  const savingsUsd = totalBaselineUsd - totalActualUsd;
  const savingsPct = totalBaselineUsd > 0 ? (savingsUsd / totalBaselineUsd) * 100 : null;

  return { rows, totalActualUsd, totalBaselineUsd, savingsUsd, savingsPct, fallbackRequests, sessions: sessionSummaries(entries) };
}
