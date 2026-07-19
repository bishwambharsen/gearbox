import { describe, expect, it } from 'vitest';
import {
  capTier,
  classifyFreshTurn,
  expectedSavingsUsd,
  hysteresisAllowsSwitch,
  upshiftCapped,
} from '../../src/router/rules.js';
import { makeConfig } from './fixtures.js';

const config = makeConfig();

describe('classifyFreshTurn', () => {
  it('routes planning/architecture markers to fable', () => {
    const h = classifyFreshTurn('help me design the architecture', config);
    expect(h.tier).toBe('fable');
    expect(h.name).toBe('planning');
  });

  it('routes "refactor across" phrase to fable', () => {
    expect(classifyFreshTurn('we need to refactor across modules', config).tier).toBe('fable');
  });

  it('caps the planning gear at maxTier', () => {
    const capped = makeConfig({ maxTier: 'opus' });
    expect(classifyFreshTurn('design this', capped).tier).toBe('opus');
  });

  it('routes debugging language to opus', () => {
    const h = classifyFreshTurn('fix the failing test and stack trace', config);
    expect(h.tier).toBe('opus');
    expect(h.name).toBe('debugging');
  });

  it('does not misfire planning on unrelated words', () => {
    // Word-boundary matching: "explain"/"explanation" must not trip the "plan" marker.
    expect(classifyFreshTurn('explain this function', config).name).not.toBe('planning');
    expect(classifyFreshTurn('add an explanation comment', config).name).not.toBe('planning');
  });

  it('routes short imperative housekeeping to haiku', () => {
    expect(classifyFreshTurn('run the tests', config).tier).toBe('haiku');
    expect(classifyFreshTurn('commit these changes', config).name).toBe('housekeeping');
  });

  it('does not treat a long message starting with a verb as housekeeping', () => {
    const long = 'show me how you would completely reorganize the persistence layer and its callers here';
    expect(classifyFreshTurn(long, config).name).not.toBe('housekeeping');
  });

  it('falls back to the default tier when no signal is present', () => {
    const h = classifyFreshTurn('add a small helper function', config);
    expect(h.tier).toBe('sonnet');
    expect(h.name).toBe('default');
  });
});

describe('tier helpers', () => {
  it('caps a tier down to the ceiling', () => {
    expect(capTier('fable', 'opus')).toBe('opus');
    expect(capTier('haiku', 'opus')).toBe('haiku');
  });

  it('upshifts one gear, clamped at the cap', () => {
    expect(upshiftCapped('sonnet', 'fable')).toBe('opus');
    expect(upshiftCapped('opus', 'opus')).toBe('opus'); // already at cap
    expect(upshiftCapped('fable', 'fable')).toBe('fable'); // top of ladder
  });
});

describe('expected savings + hysteresis', () => {
  it('yields a positive number for a worthwhile downshift', () => {
    // sonnet(3)->haiku(1): tokens*(3-1)/1e6 - tokens*1*0.9/1e6 = tokens*1.1/1e6
    expect(expectedSavingsUsd(config, 'sonnet', 'haiku', 100_000)).toBeCloseTo(0.11, 6);
  });

  it('is negative for any upshift by construction', () => {
    expect(expectedSavingsUsd(config, 'sonnet', 'fable', 100_000)).toBeLessThan(0);
  });

  it('allows a large downshift but holds a tiny one', () => {
    expect(hysteresisAllowsSwitch(config, 'sonnet', 'haiku', 50_000)).toBe(true);
    expect(hysteresisAllowsSwitch(config, 'sonnet', 'haiku', 1_000)).toBe(false);
  });

  it('never allows an upshift through the savings gate', () => {
    expect(hysteresisAllowsSwitch(config, 'sonnet', 'opus', 1_000_000)).toBe(false);
  });
});
