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
    const h = classifyFreshTurn('help me design the architecture', false, config);
    expect(h.tier).toBe('fable');
    expect(h.name).toBe('planning');
  });

  it('routes "refactor across" phrase to fable', () => {
    expect(classifyFreshTurn('we need to refactor across modules', false, config).tier).toBe('fable');
  });

  it('routes thinking-enabled requests to fable regardless of text', () => {
    expect(classifyFreshTurn('add a field', true, config).name).toBe('planning');
  });

  it('caps the planning gear at maxTier', () => {
    const capped = makeConfig({ maxTier: 'opus' });
    expect(classifyFreshTurn('design this', false, capped).tier).toBe('opus');
  });

  it('routes debugging language to opus', () => {
    const h = classifyFreshTurn('fix the failing test and stack trace', false, config);
    expect(h.tier).toBe('opus');
    expect(h.name).toBe('debugging');
  });

  it('does not misfire planning on unrelated words', () => {
    // Word-boundary matching: "explain"/"explanation" must not trip the "plan" marker.
    expect(classifyFreshTurn('explain this function', false, config).name).not.toBe('planning');
    expect(classifyFreshTurn('add an explanation comment', false, config).name).not.toBe('planning');
  });

  it('routes short imperative housekeeping to haiku', () => {
    expect(classifyFreshTurn('run the tests', false, config).tier).toBe('haiku');
    expect(classifyFreshTurn('commit these changes', false, config).name).toBe('housekeeping');
  });

  it('does not treat a long message starting with a verb as housekeeping', () => {
    const long = 'show me how you would completely reorganize the persistence layer and its callers here';
    expect(classifyFreshTurn(long, false, config).name).not.toBe('housekeeping');
  });

  it('falls back to the default tier when no signal is present', () => {
    const h = classifyFreshTurn('add a small helper function', false, config);
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
