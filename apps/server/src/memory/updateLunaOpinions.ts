import type { OllamaTextClient } from '../providers/ollamaText.js';
import { lunaOpinionsBootstrap, type LunaOpinionStore } from './lunaOpinionStore.js';
import { normalizeBulletSummary } from './userVoiceMemory.js';
import { logger } from '../logging/logger.js';

export async function updateLunaOpinions(input: {
  store: LunaOpinionStore;
  ollama: OllamaTextClient;
  guildId: string;
  callerName: string;
  userSaid: string;
  lunaReplied: string;
  existingOpinions: string | null;
}) {
  const system = [
    'You maintain Luna\'s OPINION LEDGER — stances she has taken on topics, people, media, ideas.',
    'Format each bullet: topic — her stance (she may soften or reverse later if she learns)',
    'Rules:',
    '- Output ONLY bullets starting with "- "',
    '- Max 16 bullets, max 22 words each',
    '- Only add/update when Luna actually expressed a view this turn',
    '- Keep contradictions if she is genuinely conflicted; note evolution when she changes mind',
    '- If she took no new stance, return existing opinions unchanged'
  ].join('\n');

  const userText = [
    `Opinion ledger:\n${input.existingOpinions?.trim() || lunaOpinionsBootstrap}`,
    '',
    `Exchange with ${input.callerName}:`,
    `${input.callerName}: ${input.userSaid}`,
    `Luna: ${input.lunaReplied}`,
    '',
    'Update opinions only from what Luna actually said or clearly implied.'
  ].join('\n');

  const raw = await input.ollama.generate({
    system,
    userText,
    maxCompletionTokens: 280,
    temperature: 0.38
  });

  const opinions = normalizeBulletSummary(raw, 16, 22);
  if (!opinions) return input.existingOpinions;
  input.store.save(input.guildId, opinions);
  logger.info('Updated Luna opinions', { guildId: input.guildId, bullets: opinions.split('\n').length });
  return opinions;
}
