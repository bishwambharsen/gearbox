import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLedger, readLedger } from '../../src/ledger/index.js';
import type { GearboxConfig, RouteDecision, UsageBlock } from '../../src/types.js';

let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function tempLedgerPath(...segments: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gearbox-ledger-'));
  dirs.push(dir);
  return join(dir, ...segments);
}

function baseConfig(overrides: Partial<GearboxConfig> = {}): GearboxConfig {
  return {
    port: 8484,
    upstreamBaseUrl: 'https://api.anthropic.com',
    tiers: {
      haiku: { modelId: 'claude-haiku-4-5', inputPrice: 1, outputPrice: 5, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
      sonnet: { modelId: 'claude-sonnet-5', inputPrice: 3, outputPrice: 15, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
      opus: { modelId: 'claude-opus-4-8', inputPrice: 15, outputPrice: 75, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
      fable: { modelId: 'claude-fable-5', inputPrice: 25, outputPrice: 125, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 },
    },
    defaultTier: 'sonnet',
    maxTier: 'fable',
    baselineModel: 'claude-opus-4-8',
    routing: { longContextThreshold: 150_000, escalationFailureThreshold: 2, switchMarginUsd: 0.01 },
    ledgerPath: tempLedgerPath('ledger.jsonl'),
    ...overrides,
  };
}

const sonnetDecision: RouteDecision = {
  tier: 'sonnet',
  model: 'claude-sonnet-5',
  switched: false,
  rule: 'default',
  reason: 'default tier',
};

describe('createLedger cost math', () => {
  it('computes actualCostUsd from the decision tier including cache multipliers', () => {
    const config = baseConfig();
    const ledger = createLedger(config);
    const usage: UsageBlock = {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 200,
    };

    ledger.record('s1', sonnetDecision, usage, 'claude-opus-4-8');
    const [entry] = readLedger(config.ledgerPath);

    // sonnet: inputPrice=3, outputPrice=15, cacheReadMultiplier=0.1, cacheWriteMultiplier=1.25
    // (1000*3 + 2000*15 + 500*3*0.1 + 200*3*1.25) / 1e6
    // = (3000 + 30000 + 150 + 750) / 1e6 = 33900 / 1e6
    expect(entry!.actualCostUsd).toBeCloseTo(0.0339, 10);
  });

  it('records the client-original model on the entry', () => {
    const config = baseConfig();
    const ledger = createLedger(config);
    ledger.record('s1', sonnetDecision, { input_tokens: 10, output_tokens: 10 }, 'claude-opus-4-8');
    const [entry] = readLedger(config.ledgerPath);
    expect(entry!.originalModel).toBe('claude-opus-4-8');
  });

  it('prices baselineCostUsd against the tier matching the per-request originalModel, not config.baselineModel', () => {
    const config = baseConfig({ baselineModel: 'claude-fable-5' }); // fallback, must NOT be used here
    const ledger = createLedger(config);
    const usage: UsageBlock = {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 200,
    };

    // Client originally asked for opus, even though the router downshifted to sonnet.
    ledger.record('s1', sonnetDecision, usage, 'claude-opus-4-8');
    const [entry] = readLedger(config.ledgerPath);

    // opus: inputPrice=15, outputPrice=75, cacheReadMultiplier=0.1, cacheWriteMultiplier=1.25
    // (1000*15 + 2000*75 + 500*15*0.1 + 200*15*1.25) / 1e6
    // = (15000 + 150000 + 750 + 3750) / 1e6 = 169500 / 1e6
    expect(entry!.baselineCostUsd).toBeCloseTo(0.1695, 10);
  });

  it('falls back to the config.baselineModel tier when originalModel matches no configured tier', () => {
    const config = baseConfig({ baselineModel: 'claude-opus-4-8' });
    const ledger = createLedger(config);
    const usage: UsageBlock = { input_tokens: 100, output_tokens: 100 };

    ledger.record('s1', sonnetDecision, usage, 'some-retired-model');
    const [entry] = readLedger(config.ledgerPath);

    // opus baseline fallback: (100*15 + 100*75) / 1e6 = 9000 / 1e6
    expect(entry!.baselineCostUsd).toBeCloseTo(0.009, 10);
  });

  it('falls back to the most expensive tier when neither originalModel nor baselineModel match a tier', () => {
    const config = baseConfig({ baselineModel: 'some-unconfigured-model' });
    const ledger = createLedger(config);
    const usage: UsageBlock = { input_tokens: 100, output_tokens: 100 };

    ledger.record('s1', sonnetDecision, usage, 'another-unconfigured-model');
    const [entry] = readLedger(config.ledgerPath);

    // fable is the most expensive tier: inputPrice=25, outputPrice=125
    // (100*25 + 100*125) / 1e6 = 15000 / 1e6
    expect(entry!.baselineCostUsd).toBeCloseTo(0.015, 10);
  });

  it('treats missing optional usage fields as zero', () => {
    const config = baseConfig();
    const ledger = createLedger(config);
    ledger.record('s1', sonnetDecision, { input_tokens: 10, output_tokens: 10 }, 'claude-opus-4-8');
    const [entry] = readLedger(config.ledgerPath);
    // (10*3 + 10*15) / 1e6 = 180 / 1e6
    expect(entry!.actualCostUsd).toBeCloseTo(0.00018, 10);
  });
});

describe('createLedger + readLedger JSONL round trip', () => {
  it('appends one JSON line per record and preserves order across sessions', () => {
    const config = baseConfig();
    const ledger = createLedger(config);
    ledger.record('session-a', sonnetDecision, { input_tokens: 1, output_tokens: 1 }, 'claude-opus-4-8');
    ledger.record('session-b', sonnetDecision, { input_tokens: 2, output_tokens: 2 }, 'claude-opus-4-8');
    ledger.record('session-a', sonnetDecision, { input_tokens: 3, output_tokens: 3 }, 'claude-opus-4-8');

    const raw = readFileSync(config.ledgerPath, 'utf8');
    expect(raw.trim().split('\n')).toHaveLength(3);

    const entries = readLedger(config.ledgerPath);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.sessionId)).toEqual(['session-a', 'session-b', 'session-a']);
    expect(entries[0]!.decision).toEqual(sonnetDecision);
    expect(entries[0]!.timestamp).toEqual(expect.any(String));
  });

  it('creates the parent directory for the ledger file if it does not exist yet', () => {
    const config = baseConfig({ ledgerPath: tempLedgerPath('nested', 'deep', 'ledger.jsonl') });
    expect(existsSync(config.ledgerPath)).toBe(false);
    createLedger(config).record('s1', sonnetDecision, { input_tokens: 1, output_tokens: 1 }, 'claude-opus-4-8');
    expect(existsSync(config.ledgerPath)).toBe(true);
  });

  it('skips malformed lines when reading', () => {
    const config = baseConfig();
    const ledger = createLedger(config);
    ledger.record('s1', sonnetDecision, { input_tokens: 1, output_tokens: 1 }, 'claude-opus-4-8');

    // Simulate a corrupted line (e.g. a partial write) alongside a valid one.
    appendFileSync(config.ledgerPath, 'not valid json\n');
    ledger.record('s2', sonnetDecision, { input_tokens: 2, output_tokens: 2 }, 'claude-opus-4-8');

    const entries = readLedger(config.ledgerPath);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.sessionId)).toEqual(['s1', 's2']);
  });
});

describe('readLedger', () => {
  it('returns an empty array for a missing ledger file', () => {
    const missing = tempLedgerPath('does-not-exist.jsonl');
    expect(readLedger(missing)).toEqual([]);
  });

  it('tolerates legacy lines recorded without an originalModel field', () => {
    const path = tempLedgerPath('legacy.jsonl');
    // A line written before the per-request-baseline change: no originalModel.
    const legacyLine = JSON.stringify({
      timestamp: '2026-01-01T00:00:00.000Z',
      sessionId: 's-old',
      decision: sonnetDecision,
      usage: { input_tokens: 1, output_tokens: 1 },
      actualCostUsd: 0.001,
      baselineCostUsd: 0.002,
    });
    appendFileSync(path, legacyLine + '\n');

    const entries = readLedger(path);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.sessionId).toBe('s-old');
    expect(entries[0]!.originalModel).toBeUndefined();
  });
});
