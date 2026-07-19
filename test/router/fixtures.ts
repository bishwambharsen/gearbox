// Shared test fixtures: a realistic config and Anthropic Messages-API bodies.
import type { GearboxConfig, MessagesRequestBody, ModelTier, RequestContext } from '../../src/types.js';

export function makeConfig(overrides: Partial<GearboxConfig> = {}): GearboxConfig {
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
    ledgerPath: '/tmp/gearbox-test-ledger.jsonl',
    ...overrides,
  };
}

/** A fresh human turn (plain string content). */
export function userTurn(text: string): MessagesRequestBody {
  return {
    model: 'claude-sonnet-5',
    messages: [{ role: 'user', content: text }],
  };
}

/** A tool_result continuation: agent feeds tool output back, no new human text. */
export function toolLoopTurn(includeText?: string): MessagesRequestBody {
  const content: Array<Record<string, unknown>> = [
    { type: 'tool_result', tool_use_id: 'toolu_1', content: 'exit code 0' },
  ];
  if (includeText) content.push({ type: 'text', text: includeText });
  return {
    model: 'claude-sonnet-5',
    messages: [
      { role: 'user', content: 'run the build' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} }] },
      { role: 'user', content },
    ],
  };
}

export function ctx(
  sessionId: string,
  body: MessagesRequestBody,
  estimatedInputTokens = 1000,
): RequestContext {
  return { sessionId, body, estimatedInputTokens };
}

export const TIERS: ModelTier[] = ['haiku', 'sonnet', 'opus', 'fable'];
