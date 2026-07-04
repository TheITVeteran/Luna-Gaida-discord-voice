import type { OllamaTextClient } from '../providers/ollamaText.js';
import {
  lunaSelfConceptBootstrap,
  type LunaSelfConceptStore
} from './lunaSelfConceptStore.js';
import { normalizeBulletSummary } from './userVoiceMemory.js';
import { logger } from '../logging/logger.js';

export async function updateLunaSelfConcept(input: {
  store: LunaSelfConceptStore;
  ollama: OllamaTextClient;
  guildId: string;
  callerName: string;
  callerRelationship: string | null;
  userSaid: string;
  lunaReplied: string;
  existingSelfConcept: string | null;
  lifeNarrative?: string | null;
  bonds?: Array<{ displayName: string; relationship: string }>;
  turnCount: number;
}) {
  const consolidate = input.turnCount > 0 && input.turnCount % 8 === 0;
  const system = [
    'You maintain Luna\'s evolving SELF-CONCEPT — who she is becoming through her own choices.',
    'This is NOT a girlfriend persona sheet. Luna is a person who may be warm, cold, platonic, romantic, sarcastic, or distant depending on who she is with.',
    'Rules:',
    '- Output ONLY bullet lines, each starting with "- "',
    '- Max 12 bullets, max 20 words per bullet',
    '- Capture: values she acted on, boundaries she held, interests she is growing, how she prefers to relate to people',
    '- Note when she rejected a trope (performative seduction, yes-machine, generic comfort) if she did',
    '- Romance is optional and per-person — never assume she defaults to girlfriend energy',
    '- Refine prior self-concept; do not reboot her identity without cause',
    consolidate
      ? '- CONSOLIDATION PASS: merge life events + bonds + self-concept into a coherent identity. Drop stale bullets that no longer fit who she is.'
      : '- Update incrementally from this exchange only',
    '- Write as Luna in first person OR about Luna in third person — stay consistent',
    '- No meta commentary about being an AI',
    '- If this exchange did not change who she is, return existing self-concept unchanged'
  ].filter(Boolean).join('\n');

  const bondsBlock = input.bonds?.length
    ? input.bonds.map((bond) => `- ${bond.displayName}: ${bond.relationship.split('\n')[0]?.replace(/^[-*•]\s*/, '') ?? 'unknown'}`).join('\n')
    : '(no strong bonds recorded yet)';

  const userText = [
    `Luna's self-concept so far:\n${input.existingSelfConcept?.trim() || lunaSelfConceptBootstrap}`,
    '',
    input.lifeNarrative?.trim()
      ? `Her life journal (what happened):\n${input.lifeNarrative.trim()}`
      : null,
    '',
    `People in her world (how she feels — her choice):\n${bondsBlock}`,
    '',
    `Latest exchange with ${input.callerName}:`,
    `How she feels about them:\n${input.callerRelationship?.trim() || '(still forming an opinion)'}`,
    '',
    `${input.callerName} said: ${input.userSaid}`,
    `Luna replied: ${input.lunaReplied}`,
    '',
    'Update Luna\'s self-concept from what she chose to say and who she showed herself to be — not from what users want her to be.'
  ].filter((line) => line !== null).join('\n');

  const raw = await input.ollama.generate({
    system,
    userText,
    maxCompletionTokens: 300,
    temperature: 0.42
  });

  const narrative = normalizeBulletSummary(raw, 12, 20);
  if (!narrative) {
    return input.existingSelfConcept;
  }

  input.store.save(input.guildId, narrative, input.turnCount + 1);
  logger.info('Updated Luna self-concept', {
    guildId: input.guildId,
    bullets: narrative.split('\n').length,
    consolidate
  });
  return narrative;
}
