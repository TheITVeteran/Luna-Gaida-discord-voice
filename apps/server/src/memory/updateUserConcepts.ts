import type { ConversationTurn } from '../live/conversationHistory.js';
import type { OllamaTextClient } from '../providers/ollamaText.js';
import { normalizeBulletSummary, type UserVoiceMemoryStore } from './userVoiceMemory.js';
import { logger } from '../logging/logger.js';

function formatHistoryForMemory(turns: ConversationTurn[], displayName: string) {
  if (!turns.length) return '(no prior turns this session)';
  return turns
    .map((turn) => `${turn.role === 'user' ? displayName : 'Luna'}: ${turn.text}`)
    .join('\n');
}

export async function updateUserConcepts(input: {
  store: UserVoiceMemoryStore;
  ollama: OllamaTextClient;
  guildId: string;
  userId: string;
  displayName: string;
  userSaid: string;
  lunaReplied: string;
  existingConcepts: string | null;
  existingFacts?: string | null;
  recentHistory?: ConversationTurn[];
}) {
  const subject = input.displayName.trim() || 'this user';
  const system = [
    `You maintain CONCEPT notes about one Discord voice user: ${subject}.`,
    'Concepts = higher-level understanding: themes, ongoing projects, taste clusters, shared references, what conversations are about, how they communicate.',
    'Examples of concepts (not facts):',
    '- fine-tuning Luna personality / LoRA dataset',
    '- testing discord voice music playback',
    '- banter-first, hates small talk',
    '- metal taste — Godsmack, loud honest rock',
    'Do NOT duplicate biography facts (job, pets, location) — those live elsewhere.',
    'Rules:',
    '- Output ONLY bullet lines, each starting with "- "',
    '- Max 6 bullets, max 12 words per bullet',
    `- Concepts must be about ${subject}'s themes and threads only`,
    '- Refine as you learn; drop stale or redundant concepts',
    '- If nothing new to understand, return existing concepts unchanged'
  ].join('\n');

  const userText = [
    `Subject: ${subject}`,
    `Saved concepts:\n${input.existingConcepts?.trim() || '(none yet)'}`,
    input.existingFacts?.trim()
      ? `Facts for context only (do not copy into concepts):\n${input.existingFacts.trim()}`
      : null,
    '',
    `Recent voice chat:\n${formatHistoryForMemory(input.recentHistory ?? [], subject)}`,
    '',
    'Latest exchange:',
    `${subject} said: ${input.userSaid}`,
    `Luna replied: ${input.lunaReplied}`
  ].filter(Boolean).join('\n');

  const raw = await input.ollama.generate({
    system,
    userText,
    maxCompletionTokens: 180,
    temperature: 0.25
  });

  const concepts = normalizeBulletSummary(raw, 6, 12);
  if (!concepts) {
    return input.existingConcepts;
  }

  input.store.saveConcepts(input.guildId, input.userId, input.displayName, concepts);
  logger.info('Updated Luna voice user concepts', {
    guildId: input.guildId,
    userId: input.userId,
    bullets: concepts.split('\n').length
  });
  return concepts;
}
