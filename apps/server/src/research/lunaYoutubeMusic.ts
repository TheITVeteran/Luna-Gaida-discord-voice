import type { AppConfig } from '../config/env.js';
import { logger } from '../logging/logger.js';
import {
  captureProcessOutput,
  ytDlpCommonArgs,
  youtubeMusicFormat,
  getYoutubePlayerClients,
  probeYtDlpCapabilities,
} from './ytDlpSupport.js';

const YTDLP_SEARCH_RESULTS = 5;

export interface YoutubeTrack {
  title: string;
  url: string;
  durationSeconds: number | null;
  streamUrl?: string | undefined;
  playerClients?: string | undefined;
}

export function isProbablyUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export async function resolveYoutubeTrack(config: AppConfig, query: string): Promise<YoutubeTrack> {
  if (isProbablyUrl(query)) {
    try {
      return await inspectYoutubeTrack(config, query, query);
    } catch (error) {
      throw new Error(compactYtDlpError(error));
    }
  }

  const search = await captureProcessOutput(config.YTDLP_BINARY, [
    '--flat-playlist',
    '--dump-single-json',
    '--no-warnings',
    ...ytDlpCommonArgs(config, getYoutubePlayerClients(config)[0] ?? 'android'),
    `ytsearch${YTDLP_SEARCH_RESULTS}:${query}`,
  ], 25_000);
  const parsedSearch = JSON.parse(search) as { entries?: unknown };
  const entries = Array.isArray(parsedSearch.entries) ? parsedSearch.entries : [];
  const candidates = entries
    .map((entry) => normalizeYoutubeSearchEntry(entry))
    .filter((entry): entry is YoutubeTrack => Boolean(entry));
  if (!candidates.length) {
    throw new Error('yt-dlp returned no YouTube search results');
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      return await inspectYoutubeTrack(config, candidate.url, candidate.title);
    } catch (error) {
      failures.push(`${candidate.title}: ${compactYtDlpError(error)}`);
    }
  }

  throw new Error(`No playable audio result found. ${failures.slice(0, 3).join(' | ')}`);
}

export async function inspectYoutubeTrack(
  config: AppConfig,
  url: string,
  fallbackTitle: string,
): Promise<YoutubeTrack> {
  const format = youtubeMusicFormat(config);
  const playerClients = getYoutubePlayerClients(config);
  let lastError: unknown;

  for (const playerClient of playerClients) {
    try {
      const output = await captureProcessOutput(config.YTDLP_BINARY, [
        '-f', format,
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        ...ytDlpCommonArgs(config, playerClient),
        url,
      ], 25_000);
      const line = output.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('{'));
      if (!line) throw new Error('yt-dlp returned no track metadata');
      const parsed = JSON.parse(line) as YtDlpInfo;
      const streamUrl = pickStreamUrlFromInfo(parsed);
      const resolvedUrl = firstString(parsed.webpage_url, parsed.original_url, url);
      if (!resolvedUrl) throw new Error('yt-dlp track metadata did not include a YouTube URL');
      if (!streamUrl && !hasAudioFormat(parsed)) {
        throw new Error('yt-dlp found the result, but it has no audio formats');
      }
      return {
        title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : fallbackTitle,
        url: resolvedUrl,
        durationSeconds: typeof parsed.duration === 'number' && Number.isFinite(parsed.duration) ? parsed.duration : null,
        streamUrl: streamUrl ?? undefined,
        playerClients: playerClient,
      };
    } catch (error) {
      lastError = error;
      logger.warn('yt-dlp player client failed for YouTube track', {
        playerClient,
        url,
        error: compactYtDlpError(error),
      });
    }
  }

  throw lastError ?? new Error('yt-dlp could not inspect the YouTube track');
}

export function pickStreamUrlFromInfo(parsed: YtDlpInfo): string | null {
  const direct = firstString(parsed.url);
  if (direct) return direct;

  const formats = Array.isArray(parsed.formats) ? parsed.formats : [];
  for (const format of formats) {
    const candidate = format as { url?: unknown; acodec?: unknown };
    const streamUrl = firstString(candidate.url);
    const acodec = typeof candidate.acodec === 'string' ? candidate.acodec : '';
    if (streamUrl && acodec && acodec !== 'none') {
      return streamUrl;
    }
  }
  return null;
}

function normalizeYoutubeSearchEntry(entry: unknown): YoutubeTrack | null {
  const candidate = entry as { title?: unknown; url?: unknown; webpage_url?: unknown; id?: unknown; duration?: unknown };
  const rawUrl = firstString(candidate.webpage_url, candidate.url);
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : null;
  const url = rawUrl?.startsWith('http')
    ? rawUrl
    : id
      ? `https://www.youtube.com/watch?v=${id}`
      : null;
  if (!url) {
    return null;
  }
  return {
    title: typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim() : url,
    url,
    durationSeconds: typeof candidate.duration === 'number' && Number.isFinite(candidate.duration) ? candidate.duration : null,
  };
}

function hasAudioFormat(parsed: {
  requested_downloads?: unknown;
  requested_formats?: unknown;
  formats?: unknown;
}) {
  const requestedDownloads = Array.isArray(parsed.requested_downloads) ? parsed.requested_downloads : [];
  const requestedFormats = Array.isArray(parsed.requested_formats) ? parsed.requested_formats : [];
  const formats = Array.isArray(parsed.formats) ? parsed.formats : [];
  const allFormats = [...requestedDownloads, ...requestedFormats, ...formats];
  return allFormats.some((format) => {
    const candidate = format as { acodec?: unknown; audio_ext?: unknown; vcodec?: unknown };
    return (typeof candidate.acodec === 'string' && candidate.acodec !== 'none')
      || (typeof candidate.audio_ext === 'string' && candidate.audio_ext !== 'none')
      || (typeof candidate.vcodec === 'string' && candidate.vcodec === 'none');
  });
}

export function compactYtDlpError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const errorLine = raw.split(/\r?\n/).reverse().find((line) => line.startsWith('ERROR:')) ?? raw.split(/\r?\n/).find(Boolean) ?? raw;
  if (/Sign in to confirm you.re not a bot|cookies-from-browser|authentication/i.test(raw)) {
    return 'YouTube requires authenticated cookies for this server IP. Export fresh Netscape-format cookies to the configured YTDLP_COOKIES_PATH and restart the service.';
  }
  if (/Read-only file system.*cookies/i.test(raw)) {
    return 'yt-dlp could not update its cookie jar because the configured file is read-only. Restart with the writable runtime-cookie copy enabled.';
  }
  if (/HTTP Error 403|Forbidden|unable to download video data/i.test(raw)) {
    return 'YouTube blocked the media download with HTTP 403. Verify fresh cookies, Deno JS challenge support, and yt-dlp EJS remote components; a PO-token provider may still be required.';
  }
  if (/Precondition check failed|Signature extraction failed|Requested format is not available|Only images are available/i.test(raw)) {
    const capabilities = probeYtDlpCapabilities(process.env.YTDLP_BINARY?.trim() || 'yt-dlp');
    const updateHint = !capabilities.remoteComponents
      ? ' Your yt-dlp build looks outdated — run `yt-dlp -U` and restart Luna.'
      : '';
    return `YouTube audio extraction failed (${errorLine.replace(/^ERROR:\s*/, '')}).${updateHint}`;
  }
  return errorLine.replace(/^ERROR:\s*/, '').slice(0, 500);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

type YtDlpInfo = {
  title?: unknown;
  url?: unknown;
  webpage_url?: unknown;
  original_url?: unknown;
  duration?: unknown;
  requested_downloads?: unknown;
  requested_formats?: unknown;
  formats?: unknown;
};
