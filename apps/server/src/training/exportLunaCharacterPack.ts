import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/env.js';
import { LunaSelfConceptStore } from '../memory/lunaSelfConceptStore.js';
import { LunaGoalsStore } from '../memory/lunaGoalsStore.js';
import { LunaOpinionStore } from '../memory/lunaOpinionStore.js';
import { UserVoiceMemoryStore } from '../memory/userVoiceMemory.js';

export interface LunaCharacterPack {
  exportedAt: string;
  guilds: Array<{
    guildId: string;
    selfConcept: string | null;
    goals: string | null;
    opinions: string | null;
    bonds: Array<{
      userId: string;
      displayName: string | null;
      archetype: string;
      relationship: string;
      summary: string;
    }>;
  }>;
}

export function exportLunaCharacterPack(config: AppConfig, outDir = config.lunaTrainingDatasetDir) {
  const selfConcept = new LunaSelfConceptStore(config.databasePath);
  const goals = new LunaGoalsStore(config.databasePath);
  const opinions = new LunaOpinionStore(config.databasePath);
  const voiceMemory = new UserVoiceMemoryStore(config.databasePath);

  const guildIds = new Set<string>([
    ...selfConcept.listAll(50).map((record) => record.guildId),
    ...goals.listAll(50).map((record) => record.guildId),
    ...opinions.listAll(50).map((record) => record.guildId),
    ...voiceMemory.listAll(100).map((record) => record.guildId)
  ]);

  const pack: LunaCharacterPack = {
    exportedAt: new Date().toISOString(),
    guilds: [...guildIds].map((guildId) => ({
      guildId,
      selfConcept: selfConcept.get(guildId)?.narrative?.trim() || null,
      goals: goals.get(guildId)?.goals?.trim() || null,
      opinions: opinions.get(guildId)?.opinions?.trim() || null,
      bonds: voiceMemory.listForGuild(guildId)
        .filter((record) => record.relationship.trim() || record.summary.trim())
        .map((record) => ({
          userId: record.userId,
          displayName: record.displayName,
          archetype: record.archetype,
          relationship: record.relationship,
          summary: record.summary
        }))
    }))
  };

  mkdirSync(outDir, { recursive: true });
  const filePath = join(outDir, 'luna-character-pack.json');
  writeFileSync(filePath, JSON.stringify(pack, null, 2), 'utf8');
  return { filePath, guildCount: pack.guilds.length };
}
