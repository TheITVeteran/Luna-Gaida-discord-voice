import { describe, expect, it } from 'vitest';
import { buildLunaSyntheticSeedRecords } from '../src/training/lunaSyntheticSeed.js';
import {
  buildLunaTrainingRecord,
  buildLunaTrainingState,
  formatLunaStateSystemContent
} from '../src/training/lunaTrainingState.js';
import { lunaTrainingRecordSchema } from '../src/training/lunaDatasetTypes.js';

describe('lunaTrainingState', () => {
  it('formats compact state for fine-tuning', () => {
    const state = buildLunaTrainingState({
      surface: 'discord',
      callerName: 'Alex',
      relationship: '- warming up; likes his humor',
      factsSummary: '- builds AI projects',
      conceptsSummary: '- fine-tuning Luna personality',
      lifeNarrative: '- walked home in the rain',
      hoursSinceContact: 14,
      absenceNote: 'It has been about 14 hours since you last heard from Alex.',
      recentTurns: [
        { role: 'user', text: 'hey luna' },
        { role: 'model', text: 'Hey. What do you need?' }
      ]
    });

    const system = formatLunaStateSystemContent(state);
    expect(system).toContain('<luna_state>');
    expect(system).toContain('bond_tier: warming');
    expect(system).toContain('fine-tuning Luna personality');
    expect(system).toContain('Alex: hey luna');
    expect(system).toContain('Luna: Hey. What do you need?');
    expect(system).not.toContain('You are Luna — a real person');
  });

  it('builds valid training records', () => {
    const record = buildLunaTrainingRecord({
      source: 'synthetic',
      state: buildLunaTrainingState({
        surface: 'discord',
        callerName: 'Alex',
        relationship: '- adores them',
        factsSummary: '',
        lifeNarrative: ''
      }),
      userMessage: 'missed you',
      assistant: 'I noticed the quiet too.'
    });

    expect(lunaTrainingRecordSchema.parse(record).messages).toHaveLength(3);
    expect(record.messages[0]?.role).toBe('system');
    expect(record.messages[2]?.content).toContain('noticed the quiet');
  });

  it('ships curated synthetic seeds', () => {
    const seeds = buildLunaSyntheticSeedRecords();
    expect(seeds.length).toBeGreaterThanOrEqual(8);
    for (const seed of seeds) {
      expect(lunaTrainingRecordSchema.safeParse(seed).success).toBe(true);
    }
  });
});
