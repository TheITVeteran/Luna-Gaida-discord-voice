import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { normalizeBulletSummary } from './userVoiceMemory.js';

export interface LunaGoalsRecord {
  guildId: string;
  goals: string;
  updatedAt: string;
}

interface LunaGoalsRow {
  guild_id: string;
  goals: string;
  updated_at: string;
}

export const lunaGoalsBootstrap = [
  '- Notice what genuinely interests her between calls',
  '- Follow curiosity without performing for anyone',
  '- Build real opinions, not default companion answers'
].join('\n');

export class LunaGoalsStore {
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
      CREATE TABLE IF NOT EXISTS luna_goals (
        guild_id TEXT PRIMARY KEY,
        goals TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(guildId: string): LunaGoalsRecord | null {
    const row = this.db.prepare(`
      SELECT guild_id, goals, updated_at FROM luna_goals WHERE guild_id = ?
    `).get(guildId) as LunaGoalsRow | undefined;
    return row ? { guildId: row.guild_id, goals: row.goals, updatedAt: row.updated_at } : null;
  }

  getGoals(guildId: string) {
    return this.get(guildId)?.goals?.trim() || lunaGoalsBootstrap;
  }

  save(guildId: string, goals: string) {
    const normalized = normalizeBulletSummary(goals, 10, 18);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO luna_goals (guild_id, goals, updated_at)
      VALUES (@guildId, @goals, @updatedAt)
      ON CONFLICT(guild_id) DO UPDATE SET goals = excluded.goals, updated_at = excluded.updated_at
    `).run({ guildId, goals: normalized, updatedAt: now });
    return normalized;
  }

  listAll(limit = 20): LunaGoalsRecord[] {
    const rows = this.db.prepare(`
      SELECT guild_id, goals, updated_at FROM luna_goals ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as LunaGoalsRow[];
    return rows.map((row) => ({ guildId: row.guild_id, goals: row.goals, updatedAt: row.updated_at }));
  }

  listGuildIds(limit = 50): string[] {
    const rows = this.db.prepare(`
      SELECT guild_id FROM luna_goals ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as Array<{ guild_id: string }>;
    return rows.map((row) => row.guild_id);
  }
}

export function buildGoalsPromptBlock(goals: string) {
  const notes = goals.trim() || lunaGoalsBootstrap;
  return [
    'Luna\'s own goals and intentions (what SHE wants to do, read, ask, or explore — not user tasks):',
    notes,
    'Initiative and curiosity should serve these goals when natural — not generic check-ins.'
  ].join('\n');
}
