import { describe, expect, it } from 'vitest';
import { analyzeUserSocialTone, buildSocialTonePromptBlock } from '../src/memory/socialTone.js';

describe('socialTone', () => {
  it('reads lol + insult as playful teasing for bonded users', () => {
    const analysis = analyzeUserSocialTone({
      userSaid: 'you suck at this lol jk',
      relationship: '- adores them; strong flirt dynamic'
    });
    expect(analysis.intent).toBe('playful_teasing');
    expect(analysis.bondEscalationAllowed).toBe(false);
  });

  it('reads hard hostility without joke markers as genuine', () => {
    const analysis = analyzeUserSocialTone({
      userSaid: 'shut up, I hate you',
      relationship: '- warming up; likes their humor'
    });
    expect(analysis.intent).toBe('genuine_hostility');
    expect(analysis.bondEscalationAllowed).toBe(true);
  });

  it('detects venting and seeks empathy', () => {
    const analysis = analyzeUserSocialTone({
      userSaid: "I'm so stressed, everything sucks today",
      relationship: '- acquaintance; polite so far'
    });
    expect(analysis.intent).toBe('venting');
    expect(analysis.empathyCue).toMatch(/empathy/i);
    expect(analysis.bondEscalationAllowed).toBe(false);
  });

  it('detects apologies as repair', () => {
    const analysis = analyzeUserSocialTone({
      userSaid: "sorry, I didn't mean it that way",
      relationship: '- fed up; still angry'
    });
    expect(analysis.intent).toBe('apology');
    expect(analysis.bondEscalationAllowed).toBe(false);
  });

  it('builds a social tone prompt block', () => {
    const analysis = analyzeUserSocialTone({
      userSaid: 'lmao you idiot',
      relationship: '- in love; calls them darling'
    });
    const block = buildSocialTonePromptBlock(analysis, 'Alex', 'romantic');
    expect(block).toMatch(/playful teasing/i);
    expect(block).toMatch(/Alex/);
  });
});
