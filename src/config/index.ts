import type { GearboxConfig, ModelTier, TierConfig } from '../types.js';
import { TIER_ORDER } from '../types.js';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function defaultConfig(): GearboxConfig {
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
    routing: {
      longContextThreshold: 150_000,
      escalationFailureThreshold: 2,
      switchMarginUsd: 0.01,
    },
    ledgerPath: join(homedir(), '.gearbox', 'ledger.jsonl'),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges `override` onto `base`: nested plain objects merge key-by-key, everything else (scalars, arrays) is replaced wholesale. */
function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override) || !isPlainObject(base)) {
    return (override === undefined ? base : (override as T));
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override)) {
    const baseValue = (base as Record<string, unknown>)[key];
    const overrideValue = override[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(overrideValue) ? deepMerge(baseValue, overrideValue) : overrideValue;
  }
  return result as T;
}

function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && (TIER_ORDER as string[]).includes(value);
}

function assertPositiveNumber(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid gearbox config: "${field}" must be a positive number`);
  }
}

function assertNonNegativeNumber(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid gearbox config: "${field}" must be a non-negative number`);
  }
}

function validateConfig(config: GearboxConfig): void {
  if (!isPlainObject(config.tiers)) {
    throw new Error(`Invalid gearbox config: "tiers" must be an object`);
  }
  const tiers = config.tiers as unknown as Record<string, TierConfig>;
  for (const key of Object.keys(tiers)) {
    if (!isModelTier(key)) {
      throw new Error(`Invalid gearbox config: unknown tier key "tiers.${key}"`);
    }
  }
  for (const tier of TIER_ORDER) {
    const t = tiers[tier];
    if (!t) {
      throw new Error(`Invalid gearbox config: missing tier "tiers.${tier}"`);
    }
    if (typeof t.modelId !== 'string' || t.modelId.length === 0) {
      throw new Error(`Invalid gearbox config: "tiers.${tier}.modelId" must be a non-empty string`);
    }
    assertPositiveNumber(t.inputPrice, `tiers.${tier}.inputPrice`);
    assertPositiveNumber(t.outputPrice, `tiers.${tier}.outputPrice`);
    assertNonNegativeNumber(t.cacheReadMultiplier, `tiers.${tier}.cacheReadMultiplier`);
    assertNonNegativeNumber(t.cacheWriteMultiplier, `tiers.${tier}.cacheWriteMultiplier`);
  }
  if (!isModelTier(config.defaultTier)) {
    throw new Error(`Invalid gearbox config: "defaultTier" must be one of ${TIER_ORDER.join(', ')}`);
  }
  if (!isModelTier(config.maxTier)) {
    throw new Error(`Invalid gearbox config: "maxTier" must be one of ${TIER_ORDER.join(', ')}`);
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid gearbox config: "port" must be an integer between 1 and 65535`);
  }
}

/**
 * Loads gearbox config: defaults deep-merged with an optional JSON override file.
 * `path` defaults to `~/.gearbox/config.json`. The default location missing just
 * means pure defaults, but an explicitly given path that doesn't exist is an
 * error — a typo'd GEARBOX_CONFIG must not silently fall back.
 */
export function loadConfig(path?: string): GearboxConfig {
  const resolvedPath = path ?? join(homedir(), '.gearbox', 'config.json');
  const defaults = defaultConfig();

  if (!existsSync(resolvedPath)) {
    if (path !== undefined) {
      throw new Error(`Invalid gearbox config: no file at explicitly given path "${path}"`);
    }
    return defaults;
  }

  const raw = readFileSync(resolvedPath, 'utf8');
  let userConfig: unknown;
  try {
    userConfig = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid gearbox config: could not parse JSON at "${resolvedPath}": ${(err as Error).message}`);
  }
  if (!isPlainObject(userConfig)) {
    throw new Error(`Invalid gearbox config: "${resolvedPath}" must contain a JSON object`);
  }

  const merged = deepMerge(defaults, userConfig);
  validateConfig(merged);
  return merged;
}
