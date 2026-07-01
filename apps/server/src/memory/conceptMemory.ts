export function buildConceptPromptBlock(displayName: string, concepts: string | null | undefined) {
  const who = displayName.trim() || 'this caller';
  const trimmed = concepts?.trim();
  if (!trimmed) {
    return `Concept understanding for ${who}: still forming — listen for themes, projects, tastes, and what conversations are really about.`;
  }

  return [
    `What you understand about ${who} at a concept level (themes, projects, tastes, ongoing threads — not raw biography):`,
    trimmed
  ].join('\n');
}
