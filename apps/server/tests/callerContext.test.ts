import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCallerContextBlocks, resolveCallerMemoryRecord } from '../src/memory/callerContext.js';
import { UserVoiceMemoryStore } from '../src/memory/userVoiceMemory.js';
import type { AppConfig } from '../src/config/env.js';

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    LUNA_LIFE_MEMORY: true,
    LUNA_SELF_CONCEPT: true,
    LUNA_GOALS: true,
    LUNA_OPINIONS: true,
    lunaAbsenceMissHours: 3,
    GIADA_OWNER_DISCORD_USER_ID: 'owner-1',
    lunaOwnerTwitchLogin: 'solonaras',
    databasePath: overrides.databasePath ?? ':memory:',
    ...overrides
  } as AppConfig;
}

describe('callerContext', () => {
  it('finds memory by display name and prioritizes caller facts in prompt blocks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'luna-caller-'));
    const dbPath = join(dir, 'test.sqlite');
    const store = new UserVoiceMemoryStore(dbPath);

    store.save('guild-1', 'user-1', 'Solonaras', '- Runs streams on Twitch\n- Prefers direct answers');
    store.saveRelationship('guild-1', 'user-1', 'Solonaras', '- Warm bond\n- Regular caller');

    const record = resolveCallerMemoryRecord(store, {
      guildId: 'guild-1',
      displayName: 'solonaras',
      ownerDiscordUserId: 'owner-1',
      ownerTwitchLogin: 'solonaras'
    });
    expect(record?.userId).toBe('user-1');

    const blocks = buildCallerContextBlocks({
      config: testConfig({ databasePath: dbPath }),
      userVoiceMemory: store,
      guildId: 'guild-1',
      displayName: 'Solonaras',
      userText: 'Hey Luna, remember me?',
      recentUserLines: ['Hey Luna, remember me?']
    });

    expect(blocks.callerFirstRule).toContain('Caller-first rule');
    expect(blocks.memoryBlock).toContain('Runs streams on Twitch');
    expect(blocks.relationshipBlock).toContain('Warm bond');
    expect(blocks.conceptBlock).toContain('Solonaras');

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
