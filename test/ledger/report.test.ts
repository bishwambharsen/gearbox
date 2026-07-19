import { describe, expect, it } from 'vitest';
import { aggregate, filterBySession } from '../../src/ledger/report.js';
import type { LedgerEntry, ModelTier, RouteDecision } from '../../src/types.js';

function decisionFor(tier: ModelTier): RouteDecision {
  return { tier, model: `model-${tier}`, switched: false, rule: 'r', reason: 'r' };
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    sessionId: 's1',
    decision: decisionFor('sonnet'),
    usage: { input_tokens: 100, output_tokens: 100 },
    actualCostUsd: 0.01,
    baselineCostUsd: 0.02,
    ...overrides,
  };
}

describe('aggregate', () => {
  it('sums requests, tokens and actual cost per tier, and totals + savings overall', () => {
    const entries: LedgerEntry[] = [
      entry({ decision: decisionFor('haiku'), actualCostUsd: 0.01, baselineCostUsd: 0.05, usage: { input_tokens: 100, output_tokens: 50 } }),
      entry({ decision: decisionFor('haiku'), actualCostUsd: 0.02, baselineCostUsd: 0.05, usage: { input_tokens: 200, output_tokens: 50 } }),
      entry({ decision: decisionFor('opus'), actualCostUsd: 0.1, baselineCostUsd: 0.1, usage: { input_tokens: 300, output_tokens: 300 } }),
    ];

    const summary = aggregate(entries);

    const haikuRow = summary.rows.find((r) => r.tier === 'haiku');
    expect(haikuRow).toEqual({ tier: 'haiku', requests: 2, inputTokens: 300, outputTokens: 100, actualCostUsd: expect.closeTo(0.03) });

    const opusRow = summary.rows.find((r) => r.tier === 'opus');
    expect(opusRow).toEqual({ tier: 'opus', requests: 1, inputTokens: 300, outputTokens: 300, actualCostUsd: expect.closeTo(0.1) });

    expect(summary.totalActualUsd).toBeCloseTo(0.13);
    expect(summary.totalBaselineUsd).toBeCloseTo(0.2);
    expect(summary.savingsUsd).toBeCloseTo(0.07);
    expect(summary.savingsPct).toBeCloseTo(35, 5);
  });

  it('orders rows by the canonical tier ladder regardless of entry order', () => {
    const entries: LedgerEntry[] = [
      entry({ decision: decisionFor('fable') }),
      entry({ decision: decisionFor('haiku') }),
      entry({ decision: decisionFor('opus') }),
      entry({ decision: decisionFor('sonnet') }),
    ];
    const summary = aggregate(entries);
    expect(summary.rows.map((r) => r.tier)).toEqual(['haiku', 'sonnet', 'opus', 'fable']);
  });

  it('reports null savingsPct when total baseline cost is zero', () => {
    const summary = aggregate([entry({ actualCostUsd: 0, baselineCostUsd: 0 })]);
    expect(summary.savingsPct).toBeNull();
  });

  it('returns an empty summary for no entries', () => {
    const summary = aggregate([]);
    expect(summary.rows).toEqual([]);
    expect(summary.totalActualUsd).toBe(0);
    expect(summary.totalBaselineUsd).toBe(0);
    expect(summary.savingsUsd).toBe(0);
    expect(summary.savingsPct).toBeNull();
  });
});

describe('filterBySession', () => {
  it('filters entries down to the given sessionId', () => {
    const entries = [entry({ sessionId: 'a' }), entry({ sessionId: 'b' }), entry({ sessionId: 'a' })];
    expect(filterBySession(entries, 'a')).toHaveLength(2);
  });

  it('returns all entries when no sessionId is given', () => {
    const entries = [entry({ sessionId: 'a' }), entry({ sessionId: 'b' })];
    expect(filterBySession(entries, undefined)).toHaveLength(2);
  });
});
