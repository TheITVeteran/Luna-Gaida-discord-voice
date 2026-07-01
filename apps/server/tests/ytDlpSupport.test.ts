import { describe, expect, it } from 'vitest';
import { ytDlpCommonArgs } from '../src/research/ytDlpSupport.js';
import type { AppConfig } from '../src/config/env.js';

const baseConfig = {
  YTDLP_BINARY: 'yt-dlp',
  YTDLP_PLAYER_CLIENTS: 'android,web,ios,tv,mweb',
  LUNA_YT_DEFAULT_FORMAT: 'bestaudio[ext=m4a]/bestaudio/best',
  YTDLP_JS_RUNTIME: 'deno',
  YTDLP_REMOTE_COMPONENTS: 'ejs:github',
} as AppConfig;

describe('ytDlpCommonArgs', () => {
  it('omits new flags when yt-dlp does not support them', () => {
    const args = ytDlpCommonArgs(baseConfig, 'default', {
      remoteComponents: false,
      jsRuntimes: false,
    });
    expect(args).not.toContain('--remote-components');
    expect(args).not.toContain('--js-runtimes');
    expect(args).toContain('--extractor-args');
    expect(args).toContain('youtube:player_client=default');
  });

  it('includes new flags when yt-dlp supports them', () => {
    const args = ytDlpCommonArgs(baseConfig, 'default', {
      remoteComponents: true,
      jsRuntimes: true,
    });
    expect(args).toEqual([
      '--remote-components',
      'ejs:github',
      '--js-runtimes',
      'deno',
      '--extractor-args',
      'youtube:player_client=default',
    ]);
  });
});
