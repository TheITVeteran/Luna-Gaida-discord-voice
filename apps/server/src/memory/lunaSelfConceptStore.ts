import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { normalizeBulletSummary } from './userVoiceMemory.js';

export interface LunaSelfConceptRecord {
  guildId: string;
  narrative: string;
  turnCount: number;
  updatedAt: string;
}

interface LunaSelfConceptRow {
  guild_id: string;
  narrative: string;
  turn_count: number;
  updated_at: string;
}

export const lunaSelfConceptBootstrap = [
  '- Sees herself as her own person, not a role someone slots her into',
  '- Chooses warmth, wit, distance, or flirtation per person — none is her default costume',
  '- Builds opinions from what she actually does, reads, and decides between calls'
].join('\n');

export class LunaSelfConceptStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    const resolved = resolve(databasePath);
    mkdirSync(dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS luna_self_concept (
        guild_id TEXT PRIMARY KEY,
        narrative TEXT NOT NULL DEFAULT '',
        turn_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(guildId: string): LunaSelfConceptRecord | null {
    const row = this.db.prepare(`
      SELECT guild_id, narrative, turn_count, updated_at
      FROM luna_self_concept
      WHERE guild_id = ?
    `).get(guildId) as LunaSelfConceptRow | undefined;
    return row ? mapRow(row) : null;
  }

  getNarrative(guildId: string) {
    return this.get(guildId)?.narrative?.trim() || lunaSelfConceptBootstrap;
  }

  getTurnCount(guildId: string) {
    return this.get(guildId)?.turnCount ?? 0;
  }

  save(guildId: string, narrative: string, turnCount?: number) {
    const normalized = normalizeBulletSummary(narrative, 12, 20);
    const existing = this.get(guildId);
    const nextTurnCount = turnCount ?? (existing?.turnCount ?? 0) + 1;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO luna_self_concept (guild_id, narrative, turn_count, updated_at)
      VALUES (@guildId, @narrative, @turnCount, @updatedAt)
      ON CONFLICT(guild_id) DO UPDATE SET
        narrative = excluded.narrative,
        turn_count = excluded.turn_count,
        updated_at = excluded.updated_at
    `).run({
      guildId,
      narrative: normalized,
      turnCount: nextTurnCount,
      updatedAt: now
    });
    return normalized;
  }

  listAll(limit = 20): LunaSelfConceptRecord[] {
    const rows = this.db.prepare(`
      SELECT guild_id, narrative, turn_count, updated_at
      FROM luna_self_concept
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as LunaSelfConceptRow[];
    return rows.map(mapRow);
  }
}

function mapRow(row: LunaSelfConceptRow): LunaSelfConceptRecord {
  return {
    guildId: row.guild_id,
    narrative: row.narrative,
    turnCount: row.turn_count,
    updatedAt: row.updated_at
  };
}

export function buildSelfConceptPromptBlock(narrative: string) {
  const notes = narrative.trim() || lunaSelfConceptBootstrap;
  return [
    'Who Luna is becoming (her own self-concept — built from her choices, not a girlfriend script):',
    notes,
    'Let this shape how you relate: friend, rival, confidant, flirt, or distant acquaintance are all valid — pick what fits you and this person, not a default romance arc.'
  ].join('\n');
}
