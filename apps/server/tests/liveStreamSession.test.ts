import { describe, expect, it } from 'vitest';
import {
  formatViewerRollCall,
  shouldSkipIntro,
  YoutubeLiveStreamSession
} from '../src/liveChat/liveStreamSession.js';

describe('liveStreamSession', () => {
  it('tracks unique viewers in chat order', () => {
    const session = new YoutubeLiveStreamSession('abc123');
    session.noteViewers(['Alex', 'Sam', 'Alex']);
    expect(session.getViewers()).toEqual(['Alex', 'Sam']);
  });

  it('skips intro when reconnecting to the same video', () => {
    const session = new YoutubeLiveStreamSession('abc123');
    session.introDone = true;
    expect(shouldSkipIntro(session, 'abc123')).toBe(true);
    expect(shouldSkipIntro(session, 'other-id')).toBe(false);
  });

  it('formats a roll call with overflow', () => {
    const viewers = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];
    expect(formatViewerRollCall(viewers, 12)).toBe(
      'a, b, c, d, e, f, g, h, i, j, k, l, and 1 others who chatted'
    );
  });

  it('uses a warm fallback when no viewers were recorded', () => {
    expect(formatViewerRollCall([])).toMatch(/everyone who stopped by/i);
  });
});
