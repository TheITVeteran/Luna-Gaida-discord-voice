import { describe, expect, it } from 'vitest';
import {
  isDiscordTtsTextChannelMessage,
  parseDiscordChannelIdList
} from '../src/plugins/discord/discordTtsTextChannels.js';

describe('discordTtsTextChannels', () => {
  it('parses comma-separated channel ids', () => {
    expect(parseDiscordChannelIdList('1520564757349007370, 999')).toEqual([
      '1520564757349007370',
      '999'
    ]);
  });

  it('matches voice channel chat and configured text channels', () => {
    const voiceChannelId = '1520564757349007370';
    expect(isDiscordTtsTextChannelMessage(voiceChannelId, voiceChannelId, [])).toBe(true);
    expect(isDiscordTtsTextChannelMessage('999888777', voiceChannelId, [voiceChannelId])).toBe(false);
    expect(isDiscordTtsTextChannelMessage('999888777', voiceChannelId, ['999888777'])).toBe(true);
  });
});
