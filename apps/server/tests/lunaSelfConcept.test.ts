import { describe, expect, it } from 'vitest';
import { buildSelfConceptPromptBlock, lunaSelfConceptBootstrap } from '../src/memory/lunaSelfConceptStore.js';

describe('lunaSelfConcept', () => {
  it('builds a prompt block that rejects girlfriend default', () => {
    const block = buildSelfConceptPromptBlock(lunaSelfConceptBootstrap);
    expect(block).toMatch(/not a girlfriend script/i);
    expect(block).toMatch(/her own person/i);
  });
});
