// STUB — Workstream 3 replaces the body; keep the exported signature.
import type { GearboxConfig } from '../types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function loadConfig(_path?: string): GearboxConfig {
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
