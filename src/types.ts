// Shared contracts for all Gearbox modules. Workstream agents code against
// these and must not modify this file — propose contract changes in your
// final report instead.

export type ModelTier = 'haiku' | 'sonnet' | 'opus' | 'fable';

export const TIER_ORDER: ModelTier[] = ['haiku', 'sonnet', 'opus', 'fable'];

export interface TierConfig {
  modelId: string;
  /** USD per million tokens */
  inputPrice: number;
  outputPrice: number;
  /** Multipliers on inputPrice; Anthropic defaults ≈ 0.1 read, 1.25 write */
  cacheReadMultiplier: number;
  cacheWriteMultiplier: number;
}

export interface GearboxConfig {
  port: number;
  upstreamBaseUrl: string;
  tiers: Record<ModelTier, TierConfig>;
  defaultTier: ModelTier;
  /** Highest gear the router may select without an explicit user override */
  maxTier: ModelTier;
  /** Model the counterfactual baseline cost is computed against */
  baselineModel: string;
  routing: {
    /** Context tokens (estimated) above which we refuse to downshift */
    longContextThreshold: number;
    /** Consecutive tool failures before forced upshift */
    escalationFailureThreshold: number;
    /** Minimum expected USD saving required to justify a model switch */
    switchMarginUsd: number;
  };
  ledgerPath: string;
}

/** Minimal view of an Anthropic Messages API request body we care about. */
export interface MessagesRequestBody {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  system?: unknown;
  max_tokens?: number;
  stream?: boolean;
  thinking?: unknown;
  [key: string]: unknown;
}

export interface RequestContext {
  /** Stable id for the conversation; derived from request contents/headers */
  sessionId: string;
  body: MessagesRequestBody;
  /** Rough estimate of prompt tokens (chars/4 heuristic is fine) */
  estimatedInputTokens: number;
}

export interface RouteDecision {
  tier: ModelTier;
  model: string;
  /** True when this decision changes the session's current gear */
  switched: boolean;
  /** Machine-readable rule id, e.g. "tool-loop-downshift", "escalation" */
  rule: string;
  /** Human-readable explanation for logs and the report */
  reason: string;
}

export interface Router {
  route(ctx: RequestContext): RouteDecision;
  /** Proxy feedback: a request on `tier` errored or its tool call failed */
  reportFailure(sessionId: string): void;
  reportSuccess(sessionId: string): void;
}

export interface UsageBlock {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface LedgerEntry {
  timestamp: string;
  sessionId: string;
  decision: RouteDecision;
  usage: UsageBlock;
  actualCostUsd: number;
  baselineCostUsd: number;
}

export interface Ledger {
  record(sessionId: string, decision: RouteDecision, usage: UsageBlock): void;
}

export interface GearboxServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}
