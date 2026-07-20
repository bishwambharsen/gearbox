import { describe, expect, it } from 'vitest';
import { aggregate, filterBySession, selectLastSession } from '../../src/ledger/report.js';
import type { LedgerEntry, ModelTier, RouteDecision } from '../../src/types.js';

function decisionFor(tier: ModelTier, rule = 'r'): RouteDecision {
  return { tier, model: `model-${tier}`, switched: false, rule, reason: 'r' };
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    sessionId: 's1',
    originalModel: 'claude-opus-4-8',
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
    expect(summary.fallbackRequests).toBe(0);
    expect(summary.sessions).toEqual([]);
  });

  it('counts entries whose decision.rule is proxy-fallback', () => {
    const entries: LedgerEntry[] = [
      entry({ decision: decisionFor('sonnet', 'default') }),
      entry({ decision: decisionFor('opus', 'proxy-fallback') }),
      entry({ decision: decisionFor('haiku', 'proxy-fallback') }),
    ];
    expect(aggregate(entries).fallbackRequests).toBe(2);
  });

  it('tolerates legacy entries recorded without an originalModel field', () => {
    // Entries written before the per-request-baseline change have no originalModel.
    const legacy = { ...entry(), baselineCostUsd: 0.05 } as Partial<LedgerEntry>;
    delete legacy.originalModel;
    const summary = aggregate([legacy as LedgerEntry, entry({ baselineCostUsd: 0.05 })]);
    // Aggregation still works: no crash, costs summed from the stored fields, none fabricated.
    expect(summary.totalActualUsd).toBeCloseTo(0.02);
    expect(summary.totalBaselineUsd).toBeCloseTo(0.1);
    expect(summary.sessions).toHaveLength(1);
  });

  it('summarizes per session sorted by lastTimestamp ascending', () => {
    const entries: LedgerEntry[] = [
      entry({ sessionId: 'b', timestamp: '2026-01-03T00:00:00.000Z', actualCostUsd: 0.01, baselineCostUsd: 0.03 }),
      entry({ sessionId: 'a', timestamp: '2026-01-01T00:00:00.000Z', actualCostUsd: 0.02, baselineCostUsd: 0.04 }),
      entry({ sessionId: 'a', timestamp: '2026-01-02T00:00:00.000Z', actualCostUsd: 0.05, baselineCostUsd: 0.06 }),
    ];
    const { sessions } = aggregate(entries);

    // Session a's lastTimestamp (01-02) precedes session b's (01-03).
    expect(sessions.map((s) => s.sessionId)).toEqual(['a', 'b']);
    const a = sessions[0]!;
    expect(a).toEqual({
      sessionId: 'a',
      firstTimestamp: '2026-01-01T00:00:00.000Z',
      lastTimestamp: '2026-01-02T00:00:00.000Z',
      requests: 2,
      actualCostUsd: expect.closeTo(0.07),
      baselineCostUsd: expect.closeTo(0.1),
    });
  });
});

describe('selectLastSession', () => {
  it('returns only the entries of the session with the most recent lastTimestamp', () => {
    const entries: LedgerEntry[] = [
      entry({ sessionId: 'a', timestamp: '2026-01-01T00:00:00.000Z' }),
      entry({ sessionId: 'b', timestamp: '2026-01-05T00:00:00.000Z' }),
      entry({ sessionId: 'a', timestamp: '2026-01-02T00:00:00.000Z' }),
      entry({ sessionId: 'b', timestamp: '2026-01-04T00:00:00.000Z' }),
    ];
    const selected = selectLastSession(entries);
    expect(selected).toHaveLength(2);
    expect(selected.every((e) => e.sessionId === 'b')).toBe(true);
  });

  it('returns an empty array for no entries', () => {
    expect(selectLastSession([])).toEqual([]);
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
