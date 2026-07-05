import type { AppConfig } from '../config/env.js';
import { buildConceptPromptBlock } from './conceptMemory.js';
import type { LunaGoalsStore } from './lunaGoalsStore.js';
import { buildGoalsPromptBlock } from './lunaGoalsStore.js';
import type { LunaLifeStore } from './lunaLifeStore.js';
import type { LunaOpinionStore } from './lunaOpinionStore.js';
import { buildOpinionsPromptBlock } from './lunaOpinionStore.js';
import type { LunaSelfConceptStore } from './lunaSelfConceptStore.js';
import { buildSelfConceptPromptBlock } from './lunaSelfConceptStore.js';
import {
  buildAbsencePromptBlock,
  buildRelationshipPromptBlock,
  hoursSinceLastContact,
  inferBondTier
} from './relationshipBond.js';
import {
  buildArchetypePromptBlock,
  inferArchetypeFromRelationship,
  normalizeArchetype
} from './relationshipArchetype.js';
import { analyzeUserSocialTone, buildSocialTonePromptBlock } from './socialTone.js';
import type { UserVoiceMemoryStore, VoiceUserMemory } from './userVoiceMemory.js';
import { wrapSilentContext } from '../live/voiceReply.js';

export function buildCallerFirstRule() {
  return [
    'Caller-first rule (mandatory):',
    '- Lead with THIS person — their name, what they said, and your memory of them — before poetry, philosophy, or your own life story.',
    '- If memory lists specific facts about them, use those facts; do not substitute generic persona talk.',
    '- If you barely know them, stay grounded in their message: one honest reaction or a specific question — not abstract monologue about yourself.',
    '- Your life journal and self-concept are background only unless they asked about you or it directly connects to them.'
  ].join('\n');
}

export interface CallerContextInput {
  config: AppConfig;
  userVoiceMemory: UserVoiceMemoryStore;
  lunaLife?: LunaLifeStore | undefined;
  lunaSelfConcept?: LunaSelfConceptStore | undefined;
  lunaGoals?: LunaGoalsStore | undefined;
  lunaOpinions?: LunaOpinionStore | undefined;
  guildId?: string | null | undefined;
  userId?: string | null | undefined;
  displayName: string;
  userText?: string | undefined;
  recentUserLines?: string[] | undefined;
  includeLunaBackground?: boolean | undefined;
}

export interface CallerPromptBlocks {
  callerFirstRule: string;
  memoryBlock: string;
  conceptBlock: string;
  relationshipBlock: string;
  absenceBlock: string;
  socialToneBlock: string;
  lifeBlock: string;
  selfConceptBlock: string;
  goalsBlock: string;
  opinionsBlock: string;
  record: VoiceUserMemory | null;
  resolvedGuildId: string | null;
}

export function resolveCallerMemoryRecord(
  store: UserVoiceMemoryStore,
  input: {
    guildId?: string | null | undefined;
    userId?: string | null | undefined;
    displayName: string;
    ownerDiscordUserId?: string | null | undefined;
    ownerTwitchLogin?: string | null | undefined;
  }
): VoiceUserMemory | null {
  const guildId = input.guildId?.trim() || null;
  const userId = input.userId?.trim() || null;
  if (guildId && userId) {
    const direct = store.get(guildId, userId);
    if (direct) return direct;
  }

  const twitchOwner = normalizeCallerName(input.ownerTwitchLogin ?? '');
  const displayKey = normalizeCallerName(input.displayName);
  if (twitchOwner && displayKey && twitchOwner === displayKey && input.ownerDiscordUserId && guildId) {
    const owner = store.get(guildId, input.ownerDiscordUserId);
    if (owner) return owner;
  }

  return store.findByDisplayName(input.displayName, guildId);
}

export function buildCallerContextBlocks(input: CallerContextInput): CallerPromptBlocks {
  const record = resolveCallerMemoryRecord(input.userVoiceMemory, {
    guildId: input.guildId,
    userId: input.userId,
    displayName: input.displayName,
    ownerDiscordUserId: input.config.GIADA_OWNER_DISCORD_USER_ID,
    ownerTwitchLogin: input.config.lunaOwnerTwitchLogin
  });
  const resolvedGuildId = record?.guildId ?? input.guildId?.trim() ?? null;
  const who = input.displayName.trim() || 'this person';
  const relationship = record?.relationship?.trim() || null;

  let memoryBlock = '';
  if (record?.summary?.trim()) {
    memoryBlock = `What you remember about ${who} (facts only — use these before improvising):\n${record.summary.trim()}`;
  }

  const conceptBlock = buildConceptPromptBlock(who, record?.concepts?.trim() || null);
  let relationshipBlock = buildRelationshipPromptBlock(who, relationship);
  const archetype = normalizeArchetype(record?.archetype)
    ?? inferArchetypeFromRelationship(relationship);
  relationshipBlock = `${relationshipBlock}\n${buildArchetypePromptBlock(archetype, who)}`;

  let absenceBlock = '';
  const hoursSince = hoursSinceLastContact(record?.updatedAt);
  const absence = buildAbsencePromptBlock(
    who,
    relationship,
    hoursSince,
    input.config.lunaAbsenceMissHours
  );
  if (absence) {
    absenceBlock = absence;
  }

  const userText = input.userText?.trim() ?? '';
  const socialTone = userText
    ? analyzeUserSocialTone({
      userSaid: userText,
      relationship,
      recentUserLines: input.recentUserLines ?? []
    })
    : null;
  const socialToneBlock = socialTone
    ? buildSocialTonePromptBlock(socialTone, who, inferBondTier(relationship))
    : '';

  const includeBackground = input.includeLunaBackground !== false;
  let lifeBlock = '';
  let selfConceptBlock = '';
  let goalsBlock = '';
  let opinionsBlock = '';

  if (includeBackground && resolvedGuildId) {
    if (input.config.LUNA_LIFE_MEMORY && input.lunaLife) {
      const narrative = input.lunaLife.getNarrative(resolvedGuildId);
      lifeBlock = `Your life journal (background only — mention only if relevant to ${who}):\n${narrative}`;
    }
    if (input.config.LUNA_SELF_CONCEPT && input.lunaSelfConcept) {
      selfConceptBlock = buildSelfConceptPromptBlock(input.lunaSelfConcept.getNarrative(resolvedGuildId));
    }
    if (input.config.LUNA_GOALS && input.lunaGoals) {
      goalsBlock = buildGoalsPromptBlock(input.lunaGoals.getGoals(resolvedGuildId));
    }
    if (input.config.LUNA_OPINIONS && input.lunaOpinions) {
      opinionsBlock = buildOpinionsPromptBlock(input.lunaOpinions.getOpinions(resolvedGuildId));
    }
  }

  return {
    callerFirstRule: buildCallerFirstRule(),
    memoryBlock: wrapSilentContext(memoryBlock),
    conceptBlock: wrapSilentContext(conceptBlock),
    relationshipBlock: wrapSilentContext(relationshipBlock),
    absenceBlock: wrapSilentContext(absenceBlock),
    socialToneBlock: wrapSilentContext(socialToneBlock),
    lifeBlock: wrapSilentContext(lifeBlock),
    selfConceptBlock: wrapSilentContext(selfConceptBlock),
    goalsBlock: wrapSilentContext(goalsBlock),
    opinionsBlock: wrapSilentContext(opinionsBlock),
    record,
    resolvedGuildId
  };
}

export function buildBatchCallerContextBlock(
  store: UserVoiceMemoryStore,
  config: AppConfig,
  viewers: string[],
  guildId?: string | null
) {
  const lines: string[] = ['Known viewers in this batch (use names and facts — strangers get a warm but grounded first impression):'];
  for (const viewer of viewers) {
    const record = resolveCallerMemoryRecord(store, {
      guildId,
      displayName: viewer,
      ownerDiscordUserId: config.GIADA_OWNER_DISCORD_USER_ID,
      ownerTwitchLogin: config.lunaOwnerTwitchLogin
    });
    if (!record?.summary?.trim() && !record?.relationship?.trim()) {
      lines.push(`- ${viewer}: new / no saved memory yet — focus on what they said.`);
      continue;
    }
    const bits = [
      record.summary?.trim() ? `facts: ${record.summary.trim().replace(/\n/g, ' ')}` : null,
      record.relationship?.trim() ? `bond: ${record.relationship.trim().replace(/\n/g, ' ')}` : null
    ].filter(Boolean);
    lines.push(`- ${viewer}: ${bits.join(' | ')}`);
  }
  return wrapSilentContext(lines.join('\n'));
}

function normalizeCallerName(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, '');
}
