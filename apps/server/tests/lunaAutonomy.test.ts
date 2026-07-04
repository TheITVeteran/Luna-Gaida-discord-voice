import { describe, expect, it } from 'vitest';
import { buildGoalsPromptBlock, lunaGoalsBootstrap } from '../src/memory/lunaGoalsStore.js';
import { buildOpinionsPromptBlock } from '../src/memory/lunaOpinionStore.js';
import {
  buildArchetypePromptBlock,
  inferArchetypeFromRelationship,
  parseArchetypeFromBullets
} from '../src/memory/relationshipArchetype.js';
import { buildLunaTrainingState, formatLunaStateSystemContent } from '../src/training/lunaTrainingState.js';

describe('luna autonomy', () => {
  it('builds goals prompt that rejects user errands', () => {
    const block = buildGoalsPromptBlock(lunaGoalsBootstrap);
    expect(block).toMatch(/SHE wants/i);
    expect(block).toMatch(/not user tasks/i);
  });

  it('infers archetype from relationship bullets', () => {
    expect(inferArchetypeFromRelationship('- likes banter\n- flirt energy')).toBe('flirt');
    expect(parseArchetypeFromBullets('- archetype: rival\n- fed up')).toBe('rival');
  });

  it('guides voice tone per archetype without default romance', () => {
    const block = buildArchetypePromptBlock('stranger', 'Alex');
    expect(block).toMatch(/barely know Alex/i);
    expect(block).toMatch(/No romance default/i);
  });

  it('includes character fields in training state export', () => {
    const state = buildLunaTrainingState({
      surface: 'discord',
      callerName: 'Solonaras',
      relationship: '- archetype: friend\n- warming up',
      selfConceptNarrative: '- forming her own opinions',
      goalsNarrative: '- read more sci-fi',
      opinionsNarrative: '- synthwave — underrated',
      archetype: 'friend'
    });
    const system = formatLunaStateSystemContent(state);
    expect(system).toMatch(/self_concept:/);
    expect(system).toMatch(/goals:/);
    expect(system).toMatch(/opinions:/);
    expect(system).toMatch(/archetype: friend/);
  });
});
