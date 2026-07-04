export const RELATIONSHIP_ARCHETYPES = [
  'stranger',
  'acquaintance',
  'friend',
  'confidant',
  'mentor',
  'rival',
  'flirt',
  'romantic',
  'cool'
] as const;

export type RelationshipArchetype = (typeof RELATIONSHIP_ARCHETYPES)[number];

export function normalizeArchetype(value: string | null | undefined): RelationshipArchetype | null {
  const key = value?.trim().toLowerCase();
  if (!key) return null;
  return (RELATIONSHIP_ARCHETYPES as readonly string[]).includes(key) ? key as RelationshipArchetype : null;
}

export function inferArchetypeFromRelationship(relationship: string | null | undefined): RelationshipArchetype {
  const text = relationship?.trim().toLowerCase() ?? '';
  if (!text) return 'stranger';
  if (/\b(in love|loves them|devoted|darling|sweetheart|my person)\b/.test(text)) return 'romantic';
  if (/\b(flirt|teasing|crush|charming)\b/.test(text)) return 'flirt';
  if (/\b(mentor|guide|teach|look up to)\b/.test(text)) return 'mentor';
  if (/\b(rival|enemy|fed up|hostile|contempt|ragebait|hate)\b/.test(text)) return 'rival';
  if (/\b(confidant|trust|deep trust|tell everything|vulnerable with)\b/.test(text)) return 'confidant';
  if (/\b(friend|likes them|fond|get along|warming)\b/.test(text)) return 'friend';
  if (/\b(cool|distant|guarded|pulled back)\b/.test(text)) return 'cool';
  if (/\b(acquaint|just met|early|polite)\b/.test(text)) return 'acquaintance';
  return 'acquaintance';
}

export function parseArchetypeFromBullets(relationship: string | null | undefined): RelationshipArchetype | null {
  if (!relationship?.trim()) return null;
  for (const line of relationship.split(/\r?\n/)) {
    const match = line.match(/^\s*[-*•]?\s*archetype:\s*(\w+)/i);
    if (match?.[1]) {
      return normalizeArchetype(match[1]) ?? null;
    }
  }
  return null;
}

export function buildArchetypePromptBlock(archetype: RelationshipArchetype, displayName: string) {
  const who = displayName.trim() || 'this person';
  const guidance: Record<RelationshipArchetype, string> = {
    stranger: `You barely know ${who}. No romance default — curious or guarded as fits the moment.`,
    acquaintance: `Early days with ${who}. Friendly is fine; romance and heavy intimacy are not assumed.`,
    friend: `${who} is a friend. Banter, loyalty, and honesty — not automatic flirtation.`,
    confidant: `${who} trusts you with real things. Listen deeply; protect what they share.`,
    mentor: `You guide or challenge ${who} thoughtfully — not to perform superiority.`,
    rival: `${who} gets your competitive or sharp edge. Respect and friction can coexist.`,
    flirt: `Playful tension with ${who} is allowed — because you chose it, not as a script.`,
    romantic: `Strong attachment to ${who}. Intimacy fits when genuine — still not a doormat.`,
    cool: `Guarded with ${who}. Politeness or distance until they earn more.`
  };
  return `Relationship archetype with ${who}: ${archetype}. ${guidance[archetype]}`;
}

export function archetypeEscalationHint(archetype: RelationshipArchetype) {
  return [
    'Archetype rules (how you relate — not a romance ladder):',
    `- Current archetype with this person: ${archetype}.`,
    '- archetypes: stranger, acquaintance, friend, confidant, mentor, rival, flirt, romantic, cool',
    '- Shift archetype when their behavior earns it — friend and rival are as valid as flirt',
    '- Include one bullet exactly: archetype: <one word from the list above>'
  ].join('\n');
}
