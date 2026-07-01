import { randomUUID } from 'node:crypto';
import type { ConversationTurn } from '../live/conversationHistory.js';
import { inferBondTier, type BondTier } from '../memory/relationshipBond.js';
import type { LunaTrainingRecord, LunaTrainingState, LunaTrainingTurn } from './lunaDatasetTypes.js';

const LUNA_STATE_HEADER = 'You are Luna. Use the state block for tone and memory — stay in character.';

export function bulletsFromText(text: string | null | undefined, max = 12) {
  if (!text?.trim()) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .slice(0, max);
}

export function mapConversationTurns(
  turns: Array<ConversationTurn | LunaTrainingTurn>,
  limit = 6
): LunaTrainingTurn[] {
  return turns.slice(-limit).map((turn) => ({
    role: turn.role === 'user' ? 'user' : 'assistant',
    text: turn.text,
  }));
}

export function buildLunaTrainingState(input: {
  surface: LunaTrainingState['surface'];
  callerName: string;
  relationship?: string | null;
  factsSummary?: string | null;
  conceptsSummary?: string | null;
  lifeNarrative?: string | null;
  hoursSinceContact?: number | null;
  absenceNote?: string | null;
  recentTurns?: Array<ConversationTurn | LunaTrainingTurn>;
  researchSnippet?: string | null;
}): LunaTrainingState {
  const relationshipBullets = bulletsFromText(input.relationship, 6);
  const bondTier = inferBondTier(input.relationship) as BondTier;
  const recentTurns = input.recentTurns?.length
    ? mapConversationTurns(input.recentTurns)
    : [];

  return {
    surface: input.surface,
    callerName: input.callerName.trim() || 'Caller',
    bondTier,
    relationship: relationshipBullets,
    facts: bulletsFromText(input.factsSummary, 8),
    concepts: bulletsFromText(input.conceptsSummary, 6),
    life: bulletsFromText(input.lifeNarrative, 10),
    hoursSinceContact: input.hoursSinceContact ?? null,
    absenceNote: input.absenceNote?.trim() || null,
    recentTurns,
    researchSnippet: input.researchSnippet?.trim() || null,
  };
}

export function formatLunaStateSystemContent(state: LunaTrainingState) {
  const lines = [
    LUNA_STATE_HEADER,
    `<luna_state>`,
    `surface: ${state.surface}`,
    `caller: ${state.callerName}`,
    `bond_tier: ${state.bondTier}`,
  ];

  if (state.relationship.length) {
    lines.push('relationship:');
    for (const bullet of state.relationship) lines.push(`- ${bullet}`);
  }
  if (state.facts.length) {
    lines.push('facts:');
    for (const bullet of state.facts) lines.push(`- ${bullet}`);
  }
  if (state.concepts.length) {
    lines.push('concepts:');
    for (const bullet of state.concepts) lines.push(`- ${bullet}`);
  }
  if (state.life.length) {
    lines.push('life:');
    for (const bullet of state.life) lines.push(`- ${bullet}`);
  }
  if (state.hoursSinceContact != null && Number.isFinite(state.hoursSinceContact)) {
    lines.push(`hours_since_contact: ${Math.round(state.hoursSinceContact * 10) / 10}`);
  }
  if (state.absenceNote) {
    lines.push(`absence: ${state.absenceNote}`);
  }
  if (state.researchSnippet) {
    lines.push(`research: ${state.researchSnippet}`);
  }
  if (state.recentTurns.length) {
    lines.push('recent:');
    for (const turn of state.recentTurns) {
      const label = turn.role === 'user' ? state.callerName : 'Luna';
      lines.push(`${label}: ${turn.text}`);
    }
  }
  lines.push('</luna_state>');
  return lines.join('\n');
}

export function buildLunaTrainingRecord(input: {
  source: LunaTrainingRecord['source'];
  state: LunaTrainingState;
  userMessage: string;
  assistant: string;
  createdAt?: string;
  id?: string;
}): LunaTrainingRecord {
  const userMessage = input.userMessage.replace(/\s+/g, ' ').trim();
  const assistant = input.assistant.replace(/\s+/g, ' ').trim();
  const system = formatLunaStateSystemContent(input.state);

  return {
    id: input.id ?? randomUUID(),
    source: input.source,
    createdAt: input.createdAt ?? new Date().toISOString(),
    input: {
      ...input.state,
      userMessage,
    },
    output: { assistant },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistant },
    ],
  };
}
