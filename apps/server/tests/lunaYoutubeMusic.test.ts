import { describe, expect, it } from 'vitest';
import { getYoutubePlayerClients } from '../src/research/ytDlpSupport.js';
import { pickStreamUrlFromInfo } from '../src/research/lunaYoutubeMusic.js';
import type { AppConfig } from '../src/config/env.js';

const baseConfig = {
  YTDLP_PLAYER_CLIENTS: 'android,web',
  LUNA_YT_DEFAULT_FORMAT: 'bestaudio[ext=m4a]/bestaudio/best',
} as AppConfig;

describe('getYoutubePlayerClients', () => {
  it('splits configured player clients', () => {
    expect(getYoutubePlayerClients(baseConfig)).toEqual(['android', 'web']);
  });

  it('falls back to Luna-Streamer defaults when empty', () => {
    expect(getYoutubePlayerClients({
      ...baseConfig,
      YTDLP_PLAYER_CLIENTS: '',
    })).toEqual(['android', 'web', 'ios', 'tv', 'mweb']);
  });
});

describe('pickStreamUrlFromInfo', () => {
  it('uses the top-level url when present', () => {
    expect(pickStreamUrlFromInfo({
      url: 'https://example.com/audio.m4a',
      formats: [],
    })).toBe('https://example.com/audio.m4a');
  });

  it('picks the first audio format url', () => {
    expect(pickStreamUrlFromInfo({
      formats: [
        { url: 'https://example.com/video.mp4', acodec: 'none' },
        { url: 'https://example.com/audio.webm', acodec: 'opus' },
      ],
    })).toBe('https://example.com/audio.webm');
  });
});
