// Pure extraction helpers over the Anthropic Messages request body. These read
// only the fields the router classifies on; everything else is ignored so we
// stay resilient to API surface drift.
import type { MessagesRequestBody, ModelTier } from '../types.js';
import { TIER_ORDER } from '../types.js';

type ContentBlock = { type?: string; text?: string; [key: string]: unknown };

/** Flatten a message's `content` (string or block array) into plain text. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b): b is ContentBlock => typeof b === 'object' && b !== null)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function lastMessage(body: MessagesRequestBody): { role: string; content: unknown } | undefined {
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  return messages[messages.length - 1];
}

/** Text of the most recent turn, only when that turn is a real user turn. */
export function latestUserText(body: MessagesRequestBody): string {
  const last = lastMessage(body);
  if (!last || last.role !== 'user') return '';
  return extractText(last.content).trim();
}

/**
 * A mechanical continuation: the final message is a user message whose content
 * carries at least one `tool_result` block and no substantive text — i.e. the
 * agent is feeding tool output back with nothing new from the human.
 */
export function isToolLoopContinuation(body: MessagesRequestBody): boolean {
  const last = lastMessage(body);
  if (!last || last.role !== 'user' || !Array.isArray(last.content)) return false;
  const blocks = last.content.filter(
    (b): b is ContentBlock => typeof b === 'object' && b !== null,
  );
  const hasToolResult = blocks.some((b) => b.type === 'tool_result');
  if (!hasToolResult) return false;
  const hasNewText = blocks.some(
    (b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0,
  );
  return !hasNewText;
}

/** `thinking` counts as enabled unless it is explicitly `{ type: 'disabled' }`. */
export function isThinkingEnabled(body: MessagesRequestBody): boolean {
  const t = body.thinking;
  if (!t) return false;
  if (typeof t === 'object' && t !== null && 'type' in (t as Record<string, unknown>)) {
    return (t as { type?: unknown }).type !== 'disabled';
  }
  return Boolean(t);
}

/** Parse an explicit `!gear=<tier>` override; only valid tier names are honored. */
export function parseGearOverride(text: string): ModelTier | null {
  const m = text.match(/!gear=([a-z]+)/i);
  if (!m) return null;
  const tier = m[1].toLowerCase() as ModelTier;
  return (TIER_ORDER as string[]).includes(tier) ? tier : null;
}
