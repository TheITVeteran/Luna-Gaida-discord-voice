import { describe, expect, it } from 'vitest';
import {
  formatLiveChatBatchPrompt,
  liveChatBatchFlushDelayMs,
  uniqueViewerNames
} from '../src/liveChat/liveChatBatch.js';

describe('liveChatBatch', () => {
  it('formats multiple viewer lines for the LLM', () => {
    const prompt = formatLiveChatBatchPrompt([
      { author: 'Alex', text: 'hi Luna' },
      { author: 'Sam', text: 'what game is this?' }
    ]);
    expect(prompt).toContain('Alex: hi Luna');
    expect(prompt).toContain('Sam: what game is this?');
  });

  it('deduplicates viewer names while preserving order', () => {
    expect(uniqueViewerNames([
      { author: 'Alex', text: 'one' },
      { author: 'Sam', text: 'two' },
      { author: 'alex', text: 'three' }
    ])).toEqual(['Alex', 'Sam']);
  });

  it('flushes faster when multiple messages are waiting', () => {
    expect(liveChatBatchFlushDelayMs(1, 700, 8)).toBe(700);
    expect(liveChatBatchFlushDelayMs(2, 700, 8)).toBe(200);
    expect(liveChatBatchFlushDelayMs(8, 700, 8)).toBe(0);
  });
});
