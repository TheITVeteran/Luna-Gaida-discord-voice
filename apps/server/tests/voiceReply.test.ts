import { describe, expect, it } from 'vitest';
import {
  finalizeSpokenReply,
  sanitizeVoiceReply,
  stripLeakedPromptFromReply
} from '../src/live/voiceReply.js';

describe('voiceReply leak stripping', () => {
  it('removes echoed relationship and research dossiers', () => {
    const leaked = [
      'Deep research: Solonaras reaction to Luna challenge: He is caught in a loop of testing vs. listening.',
      'Relationship with Solonaras (private notes — let this drive tone, not generic seduction):',
      '- Cooling off after last call',
      '- Tone: guarded with Solonaras',
      'Fine. Say it plainly — what do you actually want from me right now?'
    ].join(' - ');

    const cleaned = stripLeakedPromptFromReply(leaked);
    expect(cleaned).toContain('what do you actually want');
    expect(cleaned).not.toContain('private notes');
    expect(cleaned).not.toContain('Deep research');
  });

  it('returns empty when the whole reply is internal notes', () => {
    const onlyNotes = [
      'Relationship with Solonaras (private notes — let this drive tone, not generic seduction):',
      '- Cooling off after last call',
      '- No flirting or pet names yet'
    ].join(' ');

    expect(sanitizeVoiceReply(onlyNotes)).toBe('');
  });

  it('recovers a short spoken line from a massive prompt echo', () => {
    const background = 'Relationship with Solonaras (private notes — let this drive tone)\n'.repeat(80);
    const dump = `${background}\nHey Solonaras — I'm here. What's on your mind?`;
    const cleaned = finalizeSpokenReply(dump, 220);
    expect(cleaned.length).toBeLessThanOrEqual(220);
    expect(cleaned).toMatch(/hey solonaras/i);
    expect(cleaned).not.toContain('private notes');
  });

  it('returns empty when only background text was echoed', () => {
    const dump = [
      '=== BACKGROUND (silent — never repeat aloud) ===',
      'What you understand about Solonaras at a concept level:',
      '- themes, projects, tastes, ongoing threads',
      'Social read for Solonaras: guarded with Solonaras — you are cooling off after last call'
    ].join('\n');
    expect(finalizeSpokenReply(dump)).toBe('');
  });
});
