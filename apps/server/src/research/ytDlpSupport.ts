import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AppConfig } from '../config/env.js';
import { logger } from '../logging/logger.js';

export interface YtDlpCapabilities {
  remoteComponents: boolean;
  jsRuntimes: boolean;
}

const capabilityCache = new Map<string, YtDlpCapabilities>();

export function probeYtDlpCapabilities(binary: string): YtDlpCapabilities {
  const normalized = binary.trim() || 'yt-dlp';
  const cached = capabilityCache.get(normalized);
  if (cached) return cached;

  let capabilities: YtDlpCapabilities = { remoteComponents: false, jsRuntimes: false };
  try {
    const help = execFileSync(normalized, ['--help'], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    capabilities = {
      remoteComponents: /--remote-components/.test(help),
      jsRuntimes: /--js-runtimes/.test(help),
    };
    if (!capabilities.remoteComponents || !capabilities.jsRuntimes) {
      logger.info('yt-dlp is missing optional flags; using compatibility mode', {
        binary: normalized,
        remoteComponents: capabilities.remoteComponents,
        jsRuntimes: capabilities.jsRuntimes,
      });
    }
  } catch (error) {
    logger.warn('Could not probe yt-dlp capabilities; using compatibility mode', {
      binary: normalized,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  capabilityCache.set(normalized, capabilities);
  return capabilities;
}

export function captureProcessOutput(command: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    timeout.unref?.();
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk.toString('utf8'), 1024 * 1024);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString('utf8'));
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function ytDlpCommonArgs(
  config: AppConfig,
  playerClients = config.YTDLP_PLAYER_CLIENTS,
  capabilities = probeYtDlpCapabilities(config.YTDLP_BINARY),
) {
  const args: string[] = [];
  const remoteComponents = config.YTDLP_REMOTE_COMPONENTS?.trim();
  if (capabilities.remoteComponents && remoteComponents) {
    args.push('--remote-components', remoteComponents);
  }
  const jsRuntime = config.YTDLP_JS_RUNTIME?.trim();
  if (capabilities.jsRuntimes && jsRuntime) {
    args.push('--js-runtimes', jsRuntime);
  }
  args.push(
    '--extractor-args',
    `youtube:player_client=${playerClients}`,
  );
  const ffmpeg = config.FFMPEG_BINARY?.trim();
  if (ffmpeg) {
    args.push('--ffmpeg-location', ffmpeg);
  }
  const cookiesPath = config.YTDLP_COOKIES_PATH?.trim();
  if (cookiesPath && isRegularFile(cookiesPath)) {
    const writableCookiesPath = prepareWritableCookiesFile(cookiesPath);
    if (writableCookiesPath) {
      args.push('--cookies', writableCookiesPath);
    }
  }
  const cookiesFromBrowser = config.YTDLP_COOKIES_FROM_BROWSER?.trim();
  if (cookiesFromBrowser) {
    args.push('--cookies-from-browser', cookiesFromBrowser);
  }
  const potProviderUrl = config.YTDLP_POT_PROVIDER_URL?.trim();
  if (potProviderUrl) {
    args.push(
      '--extractor-args',
      `youtubepot-bgutilhttp:base_url=${potProviderUrl}`
    );
  }
  return args;
}

export const LUNA_YT_DEFAULT_FORMAT = 'bestaudio[ext=m4a]/bestaudio/best';
export const YTDLP_MUSIC_FORMAT = LUNA_YT_DEFAULT_FORMAT;

const YTDLP_DOWNLOAD_ATTEMPTS: Array<{ format: string; extractAudio?: string }> = [
  { format: LUNA_YT_DEFAULT_FORMAT, extractAudio: 'm4a' },
  { format: 'bestaudio/best', extractAudio: 'm4a' },
  { format: 'bestaudio/best' },
  { format: 'ba/b/worstaudio' },
];

export function youtubeMusicFormat(config: AppConfig) {
  return config.LUNA_YT_DEFAULT_FORMAT?.trim() || LUNA_YT_DEFAULT_FORMAT;
}

export function getYoutubePlayerClients(config: AppConfig): string[] {
  const raw = (
    process.env.LUNA_YT_PLAYER_CLIENTS?.trim()
    || config.YTDLP_PLAYER_CLIENTS?.trim()
    || 'android,web,ios,tv,mweb'
  );
  const clients = raw.split(',').map((client) => client.trim()).filter(Boolean);
  return clients.length ? clients : ['android', 'web', 'ios', 'tv', 'mweb'];
}

export async function downloadYoutubeAudioToTemp(
  config: AppConfig,
  url: string,
  playerClients?: string,
  streamUrl?: string,
) {
  const tempDir = mkdtempSync(join(tmpdir(), 'luna-music-'));
  const audioBase = join(tempDir, 'audio');
  const clientOptions = playerClients?.trim()
    ? [playerClients.trim(), ...getYoutubePlayerClients(config)]
    : getYoutubePlayerClients(config);
  const uniqueClients = [...new Set(clientOptions)];
  let lastError: unknown;

  for (const clients of uniqueClients) {
    for (const attempt of YTDLP_DOWNLOAD_ATTEMPTS) {
      try {
        const args = [
          '-f', attempt.format,
          '-o', `${audioBase}.%(ext)s`,
          '--no-playlist',
          '--no-warnings',
          ...ytDlpCommonArgs(config, clients),
        ];
        if (attempt.extractAudio) {
          args.splice(2, 0, '-x', '--audio-format', attempt.extractAudio);
        }
        args.push(url);
        await captureProcessOutput(config.YTDLP_BINARY, args, 300_000);
        const filePath = findDownloadedAudioFile(tempDir, audioBase);
        if (filePath) {
          logger.info('yt-dlp audio download succeeded', {
            playerClients: clients,
            format: attempt.format,
            extractAudio: attempt.extractAudio ?? null,
            filePath,
          });
          return { tempDir, filePath };
        }
        throw new Error('yt-dlp did not produce an audio file');
      } catch (error) {
        lastError = error;
        logger.warn('yt-dlp audio download attempt failed', {
          playerClients: clients,
          format: attempt.format,
          extractAudio: attempt.extractAudio ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (streamUrl?.trim()) {
    try {
      const filePath = await downloadStreamUrlToTemp(config, streamUrl.trim(), tempDir);
      logger.info('Downloaded YouTube audio via resolved stream URL', { filePath });
      return { tempDir, filePath };
    } catch (error) {
      lastError = error;
      logger.warn('Stream URL audio download failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  rmSync(tempDir, { recursive: true, force: true });
  throw lastError instanceof Error ? lastError : new Error('yt-dlp audio download failed');
}

async function downloadStreamUrlToTemp(config: AppConfig, streamUrl: string, tempDir: string) {
  const filePath = join(tempDir, 'audio.m4a');
  await captureProcessOutput(config.FFMPEG_BINARY, [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', streamUrl,
    '-vn',
    '-c:a', 'aac',
    '-b:a', '192k',
    filePath,
  ], 600_000);
  if (!isRegularFile(filePath)) {
    throw new Error('ffmpeg did not produce an audio file from the stream URL');
  }
  return filePath;
}

export function decodeAudioFileToDiscordPcm(
  config: AppConfig,
  filePath: string,
  positionSeconds = 0,
) {
  const seekArgs = positionSeconds > 0 ? ['-ss', positionSeconds.toFixed(3)] : [];
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(config.FFMPEG_BINARY, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', filePath,
      ...seekArgs,
      '-vn',
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk.toString('utf8'));
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

export function removeTempDir(tempDir: string | null | undefined) {
  if (!tempDir) return;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Could not remove temporary yt-dlp directory', {
      tempDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function findDownloadedAudioFile(tempDir: string, audioBase: string) {
  const prefix = basename(audioBase);
  const candidates = readdirSync(tempDir)
    .filter((name) => name.startsWith(prefix) && /\.(?:wav|m4a|webm|opus|mp3|mp4)$/i.test(name))
    .sort((a, b) => {
      const score = (file: string) => (file.endsWith('.m4a') ? 0 : file.endsWith('.webm') ? 1 : 2);
      return score(a) - score(b);
    })
    .map((name) => join(tempDir, name));
  return candidates[0] ?? null;
}

function isRegularFile(path: string) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function prepareWritableCookiesFile(sourcePath: string) {
  try {
    const directory = join(tmpdir(), 'giada-yt-dlp');
    const runtimePath = join(directory, `youtube-cookies-${process.pid}.txt`);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const sourceModifiedAt = statSync(sourcePath).mtimeMs;
    const runtimeModifiedAt = isRegularFile(runtimePath) ? statSync(runtimePath).mtimeMs : -1;
    if (sourceModifiedAt > runtimeModifiedAt) {
      copyFileSync(sourcePath, runtimePath);
      chmodSync(runtimePath, 0o600);
    }
    return runtimePath;
  } catch (error) {
    logger.warn('Could not prepare writable yt-dlp cookies file', {
      sourcePath,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function appendLimited(current: string, next: string, limit = 4000) {
  const combined = current + next;
  return combined.length > limit ? combined.slice(combined.length - limit) : combined;
}
