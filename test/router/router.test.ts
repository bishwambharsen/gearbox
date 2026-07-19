import { describe, expect, it } from 'vitest';
import { createRouter } from '../../src/router/index.js';
import { ctx, makeConfig, toolLoopTurn, userTurn } from './fixtures.js';

describe('user-override (rule 1a)', () => {
  it('obeys an explicit override and switches, uncapped by maxTier', () => {
    const router = createRouter(makeConfig({ maxTier: 'opus' }));
    const d = router.route(ctx('s', userTurn('!gear=fable please')));
    expect(d.tier).toBe('fable'); // exceeds maxTier=opus — override wins
    expect(d.rule).toBe('user-override');
    expect(d.switched).toBe(true);
    expect(d.model).toBe('claude-fable-5');
  });

  it('ignores an invalid tier name and classifies normally', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', userTurn('!gear=turbo run the tests'), 1000));
    expect(d.rule).not.toBe('user-override');
  });
});

describe('escalation (rule 1b)', () => {
  it('upshifts one gear after N consecutive failures and resets the count', () => {
    const router = createRouter(makeConfig());
    router.reportFailure('s');
    router.reportFailure('s'); // threshold = 2
    const d = router.route(ctx('s', userTurn('add a helper')));
    expect(d.rule).toBe('escalation');
    expect(d.tier).toBe('opus'); // sonnet -> opus
    expect(d.switched).toBe(true);

    // Count was reset: the next turn classifies normally, no escalation.
    const d2 = router.route(ctx('s', userTurn('add a helper'), 1000));
    expect(d2.rule).not.toBe('escalation');
  });

  it('resets failures on success before the threshold is hit', () => {
    const router = createRouter(makeConfig());
    router.reportFailure('s');
    router.reportSuccess('s');
    router.reportFailure('s');
    const d = router.route(ctx('s', userTurn('add a helper')));
    expect(d.rule).not.toBe('escalation');
  });

  it('cannot rise above the current gear when already at maxTier', () => {
    const router = createRouter(makeConfig({ defaultTier: 'opus', maxTier: 'opus' }));
    router.reportFailure('s');
    router.reportFailure('s');
    const d = router.route(ctx('s', userTurn('add a helper')));
    expect(d.rule).toBe('escalation');
    expect(d.tier).toBe('opus');
    expect(d.switched).toBe(false); // clamped at cap, count still reset
  });
});

describe('tool-loop downshift (rule 1d)', () => {
  it('downshifts to haiku at a natural boundary when savings clear the margin', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', toolLoopTurn(), 50_000));
    expect(d.rule).toBe('tool-loop-downshift');
    expect(d.tier).toBe('haiku');
    expect(d.switched).toBe(true);
  });

  it('holds when the savings do not clear the margin', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', toolLoopTurn(), 1_000));
    expect(d.rule).toBe('hysteresis-hold');
    expect(d.tier).toBe('sonnet');
    expect(d.switched).toBe(false);
  });

  it('reports the tool-loop rule with no switch when already at haiku', () => {
    const router = createRouter(makeConfig({ defaultTier: 'haiku' }));
    const d = router.route(ctx('s', toolLoopTurn(), 50_000));
    expect(d.rule).toBe('tool-loop-downshift');
    expect(d.tier).toBe('haiku');
    expect(d.switched).toBe(false);
  });
});

describe('fresh-turn heuristics + hysteresis (rules 1e, 3)', () => {
  it('housekeeping downshift switches to haiku when the margin clears', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', userTurn('run the tests'), 50_000));
    expect(d.rule).toBe('heuristic:housekeeping');
    expect(d.tier).toBe('haiku');
    expect(d.switched).toBe(true);
  });

  it('a heuristic upshift fires immediately — quality switches bypass the savings gate', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', userTurn('help me design the architecture'), 100_000));
    expect(d.rule).toBe('heuristic:planning');
    expect(d.tier).toBe('fable');
    expect(d.switched).toBe(true);
  });

  it('caps a heuristic upshift at maxTier', () => {
    const router = createRouter(makeConfig({ maxTier: 'opus' }));
    const d = router.route(ctx('s', userTurn('help me design the architecture'), 100_000));
    expect(d.rule).toBe('heuristic:planning');
    expect(d.tier).toBe('opus'); // wanted fable, clamped at the cap
    expect(d.switched).toBe(true);
  });

  it('reports heuristic:debugging with no switch when the candidate equals the current gear', () => {
    const router = createRouter(makeConfig({ defaultTier: 'opus' }));
    const d = router.route(ctx('s', userTurn('fix the failing test'), 1_000));
    expect(d.rule).toBe('heuristic:debugging');
    expect(d.tier).toBe('opus');
    expect(d.switched).toBe(false);
  });

  it('reports heuristic:default when nothing fires and stays at the default gear', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', userTurn('add a small helper function'), 1_000));
    expect(d.rule).toBe('heuristic:default');
    expect(d.tier).toBe('sonnet');
    expect(d.switched).toBe(false);
  });
});

describe('long-context guard (rule 1c)', () => {
  it('holds the current gear instead of downshifting when context is large', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', toolLoopTurn(), 200_000));
    expect(d.rule).toBe('long-context-guard');
    expect(d.tier).toBe('sonnet');
    expect(d.switched).toBe(false);
  });

  it('is inert when the candidate is already at or above the current gear', () => {
    const router = createRouter(makeConfig());
    const d = router.route(ctx('s', userTurn('add a small helper function'), 200_000));
    expect(d.rule).toBe('heuristic:default'); // guard did not engage
  });
});

describe('session state persistence', () => {
  it('remembers the gear across calls within a session', () => {
    const router = createRouter(makeConfig());
    const first = router.route(ctx('s', userTurn('!gear=opus')));
    expect(first.tier).toBe('opus');
    // A neutral small-context turn cannot clear the downshift margin, so it
    // stays at opus — proving the gear persisted from the override.
    const second = router.route(ctx('s', userTurn('add a helper'), 1_000));
    expect(second.tier).toBe('opus');
    expect(second.rule).toBe('hysteresis-hold');
    expect(second.switched).toBe(false);
  });

  it('keeps sessions independent', () => {
    const router = createRouter(makeConfig());
    router.route(ctx('a', userTurn('!gear=haiku')));
    const other = router.route(ctx('b', userTurn('add a helper'), 1_000));
    expect(other.tier).toBe('sonnet'); // session b untouched by a's override
  });
});
