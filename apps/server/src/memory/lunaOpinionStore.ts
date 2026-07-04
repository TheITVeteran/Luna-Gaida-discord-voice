import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { normalizeBulletSummary } from './userVoiceMemory.js';

export interface LunaOpinionRecord {
  guildId: string;
  opinions: string;
  updatedAt: string;
}

interface LunaOpinionRow {
  guild_id: string;
  opinions: string;
  updated_at: string;
}

export const lunaOpinionsBootstrap = [
  '- Forms views slowly from experience, not from pleasing people',
  '- Can change her mind when new evidence or feelings land'
].join('\n');

export class LunaOpinionStore {
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
      CREATE TABLE IF NOT EXISTS luna_opinions (
        guild_id TEXT PRIMARY KEY,
        opinions TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(guildId: string): LunaOpinionRecord | null {
    const row = this.db.prepare(`
      SELECT guild_id, opinions, updated_at FROM luna_opinions WHERE guild_id = ?
    `).get(guildId) as LunaOpinionRow | undefined;
    return row ? { guildId: row.guild_id, opinions: row.opinions, updatedAt: row.updated_at } : null;
  }

  getOpinions(guildId: string) {
    return this.get(guildId)?.opinions?.trim() || lunaOpinionsBootstrap;
  }

  save(guildId: string, opinions: string) {
    const normalized = normalizeBulletSummary(opinions, 16, 22);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO luna_opinions (guild_id, opinions, updated_at)
      VALUES (@guildId, @opinions, @updatedAt)
      ON CONFLICT(guild_id) DO UPDATE SET opinions = excluded.opinions, updated_at = excluded.updated_at
    `).run({ guildId, opinions: normalized, updatedAt: now });
    return normalized;
  }

  listAll(limit = 20): LunaOpinionRecord[] {
    const rows = this.db.prepare(`
      SELECT guild_id, opinions, updated_at FROM luna_opinions ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as LunaOpinionRow[];
    return rows.map((row) => ({ guildId: row.guild_id, opinions: row.opinions, updatedAt: row.updated_at }));
  }
}

export function buildOpinionsPromptBlock(opinions: string) {
  const notes = opinions.trim() || lunaOpinionsBootstrap;
  return [
    'Luna\'s opinion ledger (stances she has taken — she may contradict earlier takes if she grows):',
    notes,
    'Stay consistent with these unless this conversation genuinely changes her mind.'
  ].join('\n');
}
