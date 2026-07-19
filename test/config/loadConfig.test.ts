import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/index.js';

let dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function writeConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'gearbox-config-'));
  dirs.push(dir);
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

describe('loadConfig defaults', () => {
  it('returns documented defaults for an empty override file', () => {
    const config = loadConfig(writeConfig({}));
    expect(config.port).toBe(8484);
    expect(config.upstreamBaseUrl).toBe('https://api.anthropic.com');
    expect(config.defaultTier).toBe('sonnet');
    expect(config.maxTier).toBe('fable');
    expect(config.baselineModel).toBe('claude-opus-4-8');
    expect(config.tiers.haiku).toEqual({
      modelId: 'claude-haiku-4-5-20251001',
      inputPrice: 1,
      outputPrice: 5,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
    });
    expect(config.tiers.sonnet.modelId).toBe('claude-sonnet-5');
    expect(config.tiers.opus.modelId).toBe('claude-opus-4-8');
    expect(config.tiers.fable.modelId).toBe('claude-fable-5');
    expect(config.routing).toEqual({
      longContextThreshold: 150_000,
      escalationFailureThreshold: 2,
      switchMarginUsd: 0.01,
    });
  });

  it('throws when an explicitly given path does not exist', () => {
    const missing = join(tmpdir(), 'gearbox-definitely-missing-dir', 'config.json');
    expect(() => loadConfig(missing)).toThrow(/no file at explicitly given path/);
  });
});

describe('loadConfig deep merge', () => {
  it('merges a nested tier field without clobbering sibling fields or sibling tiers', () => {
    const config = loadConfig(writeConfig({ tiers: { sonnet: { inputPrice: 4 } } }));
    expect(config.tiers.sonnet.inputPrice).toBe(4);
    expect(config.tiers.sonnet.outputPrice).toBe(15); // untouched sibling field
    expect(config.tiers.sonnet.modelId).toBe('claude-sonnet-5'); // untouched sibling field
    expect(config.tiers.haiku.inputPrice).toBe(1); // untouched sibling tier
  });

  it('merges the routing sub-object field by field', () => {
    const config = loadConfig(writeConfig({ routing: { switchMarginUsd: 0.05 } }));
    expect(config.routing.switchMarginUsd).toBe(0.05);
    expect(config.routing.longContextThreshold).toBe(150_000);
    expect(config.routing.escalationFailureThreshold).toBe(2);
  });

  it('replaces scalar fields wholesale', () => {
    const config = loadConfig(writeConfig({ port: 9000, defaultTier: 'haiku', baselineModel: 'claude-sonnet-5' }));
    expect(config.port).toBe(9000);
    expect(config.defaultTier).toBe('haiku');
    expect(config.baselineModel).toBe('claude-sonnet-5');
  });
});

describe('loadConfig validation', () => {
  it('rejects an unknown tier key', () => {
    const path = writeConfig({
      tiers: { turbo: { modelId: 'x', inputPrice: 1, outputPrice: 1, cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25 } },
    });
    expect(() => loadConfig(path)).toThrow(/tiers\.turbo/);
  });

  it('rejects a non-positive inputPrice', () => {
    const path = writeConfig({ tiers: { haiku: { inputPrice: 0 } } });
    expect(() => loadConfig(path)).toThrow(/tiers\.haiku\.inputPrice/);
  });

  it('rejects a negative outputPrice', () => {
    const path = writeConfig({ tiers: { opus: { outputPrice: -5 } } });
    expect(() => loadConfig(path)).toThrow(/tiers\.opus\.outputPrice/);
  });

  it('rejects a negative cacheReadMultiplier', () => {
    const path = writeConfig({ tiers: { haiku: { cacheReadMultiplier: -1 } } });
    expect(() => loadConfig(path)).toThrow(/tiers\.haiku\.cacheReadMultiplier/);
  });

  it('rejects a negative cacheWriteMultiplier', () => {
    const path = writeConfig({ tiers: { haiku: { cacheWriteMultiplier: -1 } } });
    expect(() => loadConfig(path)).toThrow(/tiers\.haiku\.cacheWriteMultiplier/);
  });

  it('rejects an invalid defaultTier', () => {
    const path = writeConfig({ defaultTier: 'nonsense' });
    expect(() => loadConfig(path)).toThrow(/defaultTier/);
  });

  it('rejects an invalid maxTier', () => {
    const path = writeConfig({ maxTier: 'nonsense' });
    expect(() => loadConfig(path)).toThrow(/maxTier/);
  });

  it('rejects a port below the valid range', () => {
    const path = writeConfig({ port: 0 });
    expect(() => loadConfig(path)).toThrow(/port/);
  });

  it('rejects a port above the valid range', () => {
    const path = writeConfig({ port: 70000 });
    expect(() => loadConfig(path)).toThrow(/port/);
  });

  it('rejects malformed JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gearbox-config-'));
    dirs.push(dir);
    const path = join(dir, 'config.json');
    writeFileSync(path, '{ not valid json');
    expect(() => loadConfig(path)).toThrow();
  });
});
