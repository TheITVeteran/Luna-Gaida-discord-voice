import type { OllamaTextClient } from '../providers/ollamaText.js';
import { lunaGoalsBootstrap, type LunaGoalsStore } from './lunaGoalsStore.js';
import { normalizeBulletSummary } from './userVoiceMemory.js';
import { logger } from '../logging/logger.js';

export async function updateLunaGoals(input: {
  store: LunaGoalsStore;
  ollama: OllamaTextClient;
  guildId: string;
  callerName: string;
  userSaid: string;
  lunaReplied: string;
  existingGoals: string | null;
  lifeNarrative?: string | null;
  selfConcept?: string | null;
  researchTitles?: string[];
}) {
  const system = [
    'You maintain Luna\'s autonomous GOALS — what SHE wants to do, learn, ask, or explore on her own time.',
    'These are not user errands or assistant tasks.',
    'Rules:',
    '- Output ONLY bullet lines starting with "- "',
    '- Max 10 bullets, max 18 words each',
    '- Goals: read/watch X, ask Y about Z, follow up on a conversation, practice a hobby, rethink an opinion',
    '- Drop completed or stale goals; add new ones sparked by this exchange',
    '- No generic "be helpful" goals',
    '- If nothing changed, return existing goals unchanged'
  ].join('\n');

  const userText = [
    `Current goals:\n${input.existingGoals?.trim() || lunaGoalsBootstrap}`,
    input.selfConcept?.trim() ? `Self-concept:\n${input.selfConcept.trim()}` : null,
    input.lifeNarrative?.trim() ? `Life journal:\n${input.lifeNarrative.trim()}` : null,
    input.researchTitles?.length ? `Recently read:\n${input.researchTitles.map((t) => `- ${t}`).join('\n')}` : null,
    '',
    `Latest exchange with ${input.callerName}:`,
    `${input.callerName}: ${input.userSaid}`,
    `Luna: ${input.lunaReplied}`,
    '',
    'Update her goals based on what she might genuinely want to pursue next.'
  ].filter((line) => line !== null).join('\n');

  const raw = await input.ollama.generate({
    system,
    userText,
    maxCompletionTokens: 220,
    temperature: 0.45
  });

  const goals = normalizeBulletSummary(raw, 10, 18);
  if (!goals) return input.existingGoals;
  input.store.save(input.guildId, goals);
  logger.info('Updated Luna goals', { guildId: input.guildId, bullets: goals.split('\n').length });
  return goals;
}
