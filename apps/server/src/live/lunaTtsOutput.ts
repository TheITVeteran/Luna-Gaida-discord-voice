import { spawn } from 'node:child_process';
import type { AppConfig } from '../config/env.js';
import { logger } from '../logging/logger.js';
import { broadcastAvatarEvent } from '../ws/avatarBroadcast.js';
import { buildLipSyncFrames } from './lipSyncFrames.js';
import type { LiveClientEvent } from './liveSession.js';

export const LUNA_DISCORD_RATE = 48_000;
export const LUNA_DISCORD_CHANNELS = 2;

export async function wavToDiscordPcm(ffmpegBinary: string, wavPath: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn(ffmpegBinary, [
      '-hide_banner', '-loglevel', 'error',
      '-i', wavPath,
      '-af', 'aresample=48000:resampler=soxr',
      '-f', 's16le',
      '-ar', String(LUNA_DISCORD_RATE),
      '-ac', String(LUNA_DISCORD_CHANNELS),
      'pipe:1'
    ], { windowsHide: true });
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString('utf8').trim();
      if (message) logger.warn('ffmpeg wav decode stderr', { message });
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

export function pcmDurationMs(pcm: Buffer, sampleRate: number, channels: number) {
  const bytesPerSecond = sampleRate * channels * 2;
  return bytesPerSecond > 0 ? Math.round((pcm.length / bytesPerSecond) * 1000) : 0;
}

export function publishLunaTtsAvatarSync(
  discordPcm: Buffer,
  displayText: string,
  options?: { includeTranscript?: boolean }
) {
  if (!discordPcm.length) return;
  const frameMs = 50;
  const open = buildLipSyncFrames(discordPcm, LUNA_DISCORD_RATE, LUNA_DISCORD_CHANNELS, frameMs);
  broadcastAvatarEvent({ type: 'avatar.lipsync', payload: { frameMs, open } });
  if (options?.includeTranscript !== false && displayText.trim()) {
    broadcastAvatarEvent({
      type: 'transcript',
      speaker: 'assistant',
      text: displayText,
      final: true
    });
  }
}

export function emitLunaTtsAudio(
  discordPcm: Buffer,
  emit: ((event: LiveClientEvent) => void) | null | undefined
) {
  if (!discordPcm.length) return;
  const event: LiveClientEvent = {
    type: 'audio',
    data: discordPcm.toString('base64'),
    mimeType: 'audio/pcm;rate=48000;channels=2'
  };
  emit?.(event);
}

let discordVoiceBridgeCount = 0;
let monitorTtsEnabled = false;
let monitorTtsVolume = 1;

export function setMonitorTtsEnabled(enabled: boolean, volume = 1) {
  monitorTtsEnabled = enabled;
  monitorTtsVolume = Math.min(4, Math.max(0.1, volume));
}

export function isMonitorTtsEnabled() {
  return monitorTtsEnabled;
}

export function getMonitorTtsVolume() {
  return monitorTtsVolume;
}

function clampInt16(value: number) {
  return Math.max(-32_768, Math.min(32_767, value));
}

function scaleDiscordPcm(pcm: Buffer, gain: number) {
  if (gain === 1) return pcm;
  const out = Buffer.allocUnsafe(pcm.length);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    out.writeInt16LE(clampInt16(Math.round(pcm.readInt16LE(offset) * gain)), offset);
  }
  return out;
}

export function isLunaElectronAudioMuted() {
  return discordVoiceBridgeCount > 0;
}

function publishElectronAudioMute(muted: boolean) {
  broadcastAvatarEvent({ type: 'avatar.local_audio', payload: { muted } });
}

/** Mute Fluffy local playback while Luna speaks through Discord VC (lip sync still runs). */
export function setDiscordVoiceBridgeActive(active: boolean) {
  if (active) {
    discordVoiceBridgeCount += 1;
    if (discordVoiceBridgeCount === 1) {
      publishElectronAudioMute(true);
    }
    return;
  }
  discordVoiceBridgeCount = Math.max(0, discordVoiceBridgeCount - 1);
  if (discordVoiceBridgeCount === 0) {
    publishElectronAudioMute(false);
  }
}

export function broadcastLunaTtsAudio(discordPcm: Buffer) {
  if (!discordPcm.length) return;
  const avatarMuted = isLunaElectronAudioMuted();
  if (avatarMuted && !monitorTtsEnabled) return;
  const pcm = monitorTtsEnabled && monitorTtsVolume !== 1
    ? scaleDiscordPcm(discordPcm, monitorTtsVolume)
    : discordPcm;
  broadcastAvatarEvent({
    type: 'audio',
    data: pcm.toString('base64'),
    mimeType: 'audio/pcm;rate=48000;channels=2'
  });
}

export function lunaTtsPlaybackMs(pcm: Buffer) {
  return pcmDurationMs(pcm, LUNA_DISCORD_RATE, LUNA_DISCORD_CHANNELS) + 1_000;
}
