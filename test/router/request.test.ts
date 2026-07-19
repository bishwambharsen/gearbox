import { describe, expect, it } from 'vitest';
import { isToolLoopContinuation, latestUserText, parseGearOverride } from '../../src/router/request.js';
import { toolLoopTurn, userTurn } from './fixtures.js';

describe('latestUserText', () => {
  it('reads plain string content of the last user message', () => {
    expect(latestUserText(userTurn('fix the bug'))).toBe('fix the bug');
  });

  it('flattens text blocks and ignores non-text blocks', () => {
    const body = {
      model: 'm',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'image', source: {} }] },
      ],
    };
    expect(latestUserText(body)).toBe('hello');
  });

  it('returns empty when the last message is not a user turn', () => {
    const body = { model: 'm', messages: [{ role: 'assistant', content: 'thinking...' }] };
    expect(latestUserText(body)).toBe('');
  });

  it('returns empty for an empty message list', () => {
    expect(latestUserText({ model: 'm', messages: [] })).toBe('');
  });
});

describe('isToolLoopContinuation', () => {
  it('is true when the last user message is only tool_result blocks', () => {
    expect(isToolLoopContinuation(toolLoopTurn())).toBe(true);
  });

  it('is false when a substantive text block accompanies the tool_result', () => {
    expect(isToolLoopContinuation(toolLoopTurn('now do the next thing'))).toBe(false);
  });

  it('is still true when the accompanying text block is blank', () => {
    expect(isToolLoopContinuation(toolLoopTurn('   '))).toBe(true);
  });

  it('is false for a plain user turn', () => {
    expect(isToolLoopContinuation(userTurn('hello'))).toBe(false);
  });
});

describe('parseGearOverride', () => {
  it('parses a valid tier override embedded in text', () => {
    expect(parseGearOverride('please !gear=opus and continue')).toBe('opus');
  });
  it('is case-insensitive', () => {
    expect(parseGearOverride('!GEAR=Fable')).toBe('fable');
  });
  it('rejects an unknown tier name', () => {
    expect(parseGearOverride('!gear=turbo')).toBeNull();
  });
  it('returns null when no override present', () => {
    expect(parseGearOverride('just a normal message')).toBeNull();
  });
});
