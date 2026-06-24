import { describe, expect, it } from 'vitest';
import {
  buildDiscordApplicationEmojiInstruction,
  discordApplicationEmojiMention
} from '../src/plugins/discord/applicationEmojis.js';

describe('Discord application emoji prompt', () => {
  it('provides every emoji as an exact Discord token', () => {
    const instruction = buildDiscordApplicationEmojiInstruction([
      { id: '1519393755764101320', name: 'GiadaCheer' },
      { id: '1519393755764101321', name: 'GiadaDance', animated: true }
    ]);

    expect(instruction).toContain('Prefer the available Discord application emojis');
    expect(instruction).toContain('GiadaCheer: <:GiadaCheer:1519393755764101320>');
    expect(instruction).toContain('GiadaDance: <a:GiadaDance:1519393755764101321>');
    expect(instruction).toContain('Never output only its name');
  });

  it('formats static and animated emoji mentions', () => {
    expect(discordApplicationEmojiMention({ id: '123', name: 'Static' })).toBe('<:Static:123>');
    expect(discordApplicationEmojiMention({ id: '456', name: 'Animated', animated: true })).toBe('<a:Animated:456>');
  });

  it('tells Giada not to invent emojis when none are available', () => {
    expect(buildDiscordApplicationEmojiInstruction([])).toContain('Do not invent custom emoji names or IDs');
  });
});
