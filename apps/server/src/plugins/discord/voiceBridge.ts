import {
  AudioPlayerStatus,
  EndBehaviorType,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  type AudioPlayer,
  type VoiceConnection,
  type VoiceConnectionState
} from '@discordjs/voice';
import { PassThrough } from 'node:stream';
import prism from 'prism-media';
import type { AppConfig } from '../../config/env.js';
import { LiveSessionManager, type LiveClientEvent } from '../../live/liveSession.js';
import type { MemoryRepository } from '../../memory/repository.js';
import type { PersonalityService } from '../../personality/service.js';
import { logger } from '../../logging/logger.js';

const DISCORD_RATE = 48000;
const DISCORD_CHANNELS = 2;
const GEMINI_INPUT_RATE = 16000;
const GEMINI_OUTPUT_RATE = 24000;
const SPEECH_END_SILENCE_MS = 900;

interface VoiceBridgeDiagnostics {
  attached: boolean;
  channelId: string | null;
  connectionStatus: string | null;
  receiverAttached: boolean;
  playerStatus: string;
  activeInputUsers: number;
  speakingStarts: number;
  rawUdpPackets: number;
  mappedUdpPackets: number;
  unmappedUdpPackets: number;
  opusBytes: number;
  decodedPcmBytes: number;
  geminiInputBytes: number;
  geminiTurnCompletes: number;
  geminiAudioEvents: number;
  geminiOutputBytes: number;
  discordOutputBytes: number;
  lastSpeakingAt: string | null;
  lastRawUdpAt: string | null;
  lastUdpSsrc: number | null;
  lastOpusAt: string | null;
  lastDecodedAt: string | null;
  lastGeminiInputAt: string | null;
  lastGeminiTurnCompleteAt: string | null;
  lastGeminiAudioAt: string | null;
  lastDiscordWriteAt: string | null;
  lastError: string | null;
}

export class DiscordVoiceBridge {
  private readonly live: LiveSessionManager;
  private readonly player: AudioPlayer;
  private readonly output = new PassThrough({ highWaterMark: 1024 * 1024 });
  private connection: VoiceConnection | null = null;
  private channelId: string | null = null;
  private speakingHandler: ((userId: string) => void) | null = null;
  private connectionStateHandler: ((oldState: VoiceConnectionState, newState: VoiceConnectionState) => void) | null = null;
  private udpDiagnosticsSocket: { on(event: 'message', listener: (message: Buffer) => void): unknown; off(event: 'message', listener: (message: Buffer) => void): unknown } | null = null;
  private udpDiagnosticsHandler: ((message: Buffer) => void) | null = null;
  private readonly activeInputUsers = new Set<string>();
  private inputQueue: Promise<void> = Promise.resolve();
  private destroyed = false;
  private diagnostics: VoiceBridgeDiagnostics = {
    attached: false,
    channelId: null,
    connectionStatus: null,
    receiverAttached: false,
    playerStatus: AudioPlayerStatus.Idle,
    activeInputUsers: 0,
    speakingStarts: 0,
    rawUdpPackets: 0,
    mappedUdpPackets: 0,
    unmappedUdpPackets: 0,
    opusBytes: 0,
    decodedPcmBytes: 0,
    geminiInputBytes: 0,
    geminiTurnCompletes: 0,
    geminiAudioEvents: 0,
    geminiOutputBytes: 0,
    discordOutputBytes: 0,
    lastSpeakingAt: null,
    lastRawUdpAt: null,
    lastUdpSsrc: null,
    lastOpusAt: null,
    lastDecodedAt: null,
    lastGeminiInputAt: null,
    lastGeminiTurnCompleteAt: null,
    lastGeminiAudioAt: null,
    lastDiscordWriteAt: null,
    lastError: null
  };

  constructor(
    private readonly guildId: string,
    private readonly botUserId: string,
    private readonly resolveSpeakerName: (userId: string) => string,
    config: AppConfig,
    memory: MemoryRepository,
    personality: PersonalityService
  ) {
    this.live = new LiveSessionManager(config, memory, personality);
    this.live.setEmitter((event) => this.handleLiveEvent(event));

    this.player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Play
      }
    });
    this.player.on('error', (error) => {
      this.recordError(error.message);
      logger.error('Discord voice audio player failed', {
        guildId: this.guildId,
        error: error.message
      });
    });
    this.player.on('stateChange', (_oldState, newState) => {
      this.diagnostics.playerStatus = newState.status;
    });
    this.player.on(AudioPlayerStatus.Idle, () => {
      if (!this.destroyed && !this.output.destroyed) {
        this.player.play(createAudioResource(this.output, { inputType: StreamType.Raw }));
      }
    });
    this.player.play(createAudioResource(this.output, { inputType: StreamType.Raw }));
  }

  attach(connection: VoiceConnection, channelId: string) {
    const sameConnection = this.connection === connection;
    const sameChannel = this.channelId === channelId;
    if (sameConnection && sameChannel) {
      connection.subscribe(this.player);
      if (connection.state.status === VoiceConnectionStatus.Ready) {
        this.attachReceiver(connection);
      }
      return;
    }

    if (!sameConnection) {
      this.detachReceiver();
      this.detachConnectionStateHandler();
      this.connection = connection;
      this.attachConnectionStateHandler(connection);
    }
    this.channelId = channelId;
    this.diagnostics.attached = true;
    this.diagnostics.channelId = channelId;
    this.diagnostics.connectionStatus = connection.state.status;
    connection.subscribe(this.player);
    this.attachUdpDiagnostics(connection);

    if (connection.state.status === VoiceConnectionStatus.Ready) {
      this.attachReceiver(connection);
    }
  }

  getStatus() {
    return {
      guildId: this.guildId,
      ...this.diagnostics,
      connectionStatus: this.connection?.state.status ?? this.diagnostics.connectionStatus,
      activeInputUsers: this.activeInputUsers.size
    };
  }

  destroy() {
    this.destroyed = true;
    this.detachReceiver();
    this.detachUdpDiagnostics();
    this.detachConnectionStateHandler();
    this.player.stop(true);
    this.output.destroy();
    this.live.close();
    this.connection = null;
    this.channelId = null;
    this.diagnostics.attached = false;
    this.diagnostics.channelId = null;
    this.diagnostics.connectionStatus = VoiceConnectionStatus.Destroyed;
    this.diagnostics.receiverAttached = false;
  }

  private attachConnectionStateHandler(connection: VoiceConnection) {
    this.connectionStateHandler = (_oldState, newState) => {
      this.diagnostics.connectionStatus = newState.status;
      if (this.destroyed || this.connection !== connection) {
        return;
      }

      if (newState.status === VoiceConnectionStatus.Ready) {
        this.attachUdpDiagnostics(connection);
        this.attachReceiver(connection);
        return;
      }

      if (newState.status === VoiceConnectionStatus.Destroyed) {
        this.detachReceiver();
        this.detachUdpDiagnostics();
        this.live.close();
        this.connection = null;
        this.channelId = null;
      }
    };
    connection.on('stateChange', this.connectionStateHandler);
  }

  private detachConnectionStateHandler() {
    if (this.connection && this.connectionStateHandler) {
      this.connection.off('stateChange', this.connectionStateHandler);
    }
    this.connectionStateHandler = null;
  }

  private attachReceiver(connection: VoiceConnection) {
    if (this.speakingHandler) {
      return;
    }
    this.speakingHandler = (userId) => {
      if (userId === this.botUserId || this.activeInputUsers.has(userId)) {
        return;
      }
      this.diagnostics.speakingStarts += 1;
      this.diagnostics.lastSpeakingAt = new Date().toISOString();
      this.receiveUserSpeech(connection, userId);
    };
    connection.receiver.speaking.on('start', this.speakingHandler);
    this.diagnostics.receiverAttached = true;
  }

  private detachReceiver() {
    if (this.connection && this.speakingHandler) {
      this.connection.receiver.speaking.off('start', this.speakingHandler);
    }
    this.speakingHandler = null;
    this.activeInputUsers.clear();
    this.diagnostics.receiverAttached = false;
    this.diagnostics.activeInputUsers = 0;
  }

  private attachUdpDiagnostics(connection: VoiceConnection) {
    const networking = 'networking' in connection.state ? connection.state.networking : null;
    const udp = networking && 'state' in networking && 'udp' in networking.state ? networking.state.udp : null;
    if (!udp || udp === this.udpDiagnosticsSocket) {
      return;
    }
    this.detachUdpDiagnostics();
    this.udpDiagnosticsSocket = udp;
    this.udpDiagnosticsHandler = (message: Buffer) => {
      if (message.length <= 8) {
        return;
      }
      const ssrc = message.readUInt32BE(8);
      this.diagnostics.rawUdpPackets += 1;
      this.diagnostics.lastRawUdpAt = new Date().toISOString();
      this.diagnostics.lastUdpSsrc = ssrc;
      const mappedUser = connection.receiver.ssrcMap.get(ssrc);
      if (mappedUser) {
        this.diagnostics.mappedUdpPackets += 1;
      } else {
        this.diagnostics.unmappedUdpPackets += 1;
      }
      if (this.diagnostics.rawUdpPackets <= 3 || this.diagnostics.rawUdpPackets % 100 === 0) {
        logger.debug('Discord voice received raw UDP audio packet', {
          guildId: this.guildId,
          channelId: this.channelId,
          ssrc,
          mappedUserId: mappedUser?.userId ?? null,
          rawUdpPackets: this.diagnostics.rawUdpPackets,
          mappedUdpPackets: this.diagnostics.mappedUdpPackets,
          unmappedUdpPackets: this.diagnostics.unmappedUdpPackets
        });
      }
    };
    udp.on('message', this.udpDiagnosticsHandler);
  }

  private detachUdpDiagnostics() {
    if (this.udpDiagnosticsSocket && this.udpDiagnosticsHandler) {
      this.udpDiagnosticsSocket.off('message', this.udpDiagnosticsHandler);
    }
    this.udpDiagnosticsSocket = null;
    this.udpDiagnosticsHandler = null;
  }

  private receiveUserSpeech(connection: VoiceConnection, userId: string) {
    this.activeInputUsers.add(userId);
    this.diagnostics.activeInputUsers = this.activeInputUsers.size;
    this.queueGeminiText([
      'Discord voice metadata:',
      `Speaker display name: ${this.resolveSpeakerName(userId)}`,
      `Speaker user ID: ${userId}`,
      'Treat the following audio as spoken by this speaker. Do not respond to this metadata by itself.'
    ].join('\n'));

    const opusStream = connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: SPEECH_END_SILENCE_MS
      }
    });
    const decoder = new prism.opus.Decoder({
      frameSize: 960,
      channels: DISCORD_CHANNELS,
      rate: DISCORD_RATE
    });
    let forwardedAudio = false;
    let loggedDecodedAudio = false;
    let cleanedUp = false;
    const cleanup = (completeTurn: boolean) => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      this.activeInputUsers.delete(userId);
      this.diagnostics.activeInputUsers = this.activeInputUsers.size;
      if (completeTurn && forwardedAudio) {
        this.queueGeminiTurnComplete();
      }
    };

    opusStream.on('data', (chunk: Buffer) => {
      this.diagnostics.opusBytes += chunk.length;
      this.diagnostics.lastOpusAt = new Date().toISOString();
    });
    opusStream.once('error', (error) => {
      cleanup(false);
      this.recordError(error instanceof Error ? error.message : String(error));
      logger.warn('Discord voice Opus receive stream failed', {
        guildId: this.guildId,
        channelId: this.channelId,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    decoder.once('end', () => {
      cleanup(true);
    });
    decoder.once('close', () => {
      cleanup(true);
    });
    decoder.once('error', (error) => {
      cleanup(false);
      this.recordError(error instanceof Error ? error.message : String(error));
      logger.warn('Discord voice PCM decoder failed', {
        guildId: this.guildId,
        channelId: this.channelId,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    opusStream
      .pipe(decoder)
      .on('data', (chunk: Buffer) => {
        this.diagnostics.decodedPcmBytes += chunk.length;
        this.diagnostics.lastDecodedAt = new Date().toISOString();
        if (!loggedDecodedAudio) {
          loggedDecodedAudio = true;
          logger.debug('Discord voice received decoded audio', {
            guildId: this.guildId,
            channelId: this.channelId,
            userId,
            pcmBytes: chunk.length,
            totalDecodedPcmBytes: this.diagnostics.decodedPcmBytes
          });
        }
        const pcm16k = downsampleDiscordPcmForGemini(chunk);
        if (pcm16k.length > 0) {
          forwardedAudio = true;
          this.queueGeminiInput(pcm16k);
        }
      });
  }

  private queueGeminiText(text: string) {
    this.inputQueue = this.inputQueue
      .then(() => this.live.handleInput({
        type: 'text',
        text
      }, 'discord'))
      .catch((error) => {
        logger.warn('Failed to forward Discord voice speaker metadata to Gemini Live', {
          guildId: this.guildId,
          channelId: this.channelId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private queueGeminiInput(pcm: Buffer) {
    this.diagnostics.geminiInputBytes += pcm.length;
    this.diagnostics.lastGeminiInputAt = new Date().toISOString();
    logger.debug('Discord voice forwarding audio to Gemini Live', {
      guildId: this.guildId,
      channelId: this.channelId,
      pcmBytes: pcm.length,
      totalGeminiInputBytes: this.diagnostics.geminiInputBytes
    });
    const data = pcm.toString('base64');
    this.inputQueue = this.inputQueue
      .then(() => this.live.handleInput({
        type: 'audio',
        data,
        mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`
      }, 'discord'))
      .catch((error) => {
        logger.warn('Failed to forward Discord voice audio to Gemini Live', {
          guildId: this.guildId,
          channelId: this.channelId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private queueGeminiTurnComplete() {
    this.diagnostics.geminiTurnCompletes += 1;
    this.diagnostics.lastGeminiTurnCompleteAt = new Date().toISOString();
    this.inputQueue = this.inputQueue
      .then(() => this.live.handleInput({
        type: 'turnComplete'
      }, 'discord'))
      .catch((error) => {
        this.recordError(error instanceof Error ? error.message : String(error));
        logger.warn('Failed to complete Discord voice turn in Gemini Live', {
          guildId: this.guildId,
          channelId: this.channelId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private handleLiveEvent(event: LiveClientEvent) {
    if (event.type !== 'audio') {
      return;
    }
    const pcm24k = Buffer.from(event.data, 'base64');
    this.diagnostics.geminiAudioEvents += 1;
    this.diagnostics.geminiOutputBytes += pcm24k.length;
    this.diagnostics.lastGeminiAudioAt = new Date().toISOString();
    logger.debug('Discord voice received Gemini audio', {
      guildId: this.guildId,
      channelId: this.channelId,
      pcmBytes: pcm24k.length,
      audioEvents: this.diagnostics.geminiAudioEvents,
      totalGeminiOutputBytes: this.diagnostics.geminiOutputBytes
    });
    const discordPcm = upsampleGeminiPcmForDiscord(pcm24k);
    if (discordPcm.length > 0 && !this.output.destroyed) {
      logger.debug('Discord voice writing audio to Discord output', {
        guildId: this.guildId,
        channelId: this.channelId,
        pcmBytes: discordPcm.length,
        playerStatus: this.diagnostics.playerStatus,
        connectionStatus: this.connection?.state.status ?? this.diagnostics.connectionStatus
      });
      this.output.write(discordPcm);
      this.diagnostics.discordOutputBytes += discordPcm.length;
      this.diagnostics.lastDiscordWriteAt = new Date().toISOString();
    }
  }

  private recordError(error: string) {
    this.diagnostics.lastError = error;
  }
}

function downsampleDiscordPcmForGemini(input: Buffer) {
  const completeFrames = Math.floor(input.length / (DISCORD_CHANNELS * 2));
  const outputFrames = Math.floor(completeFrames * GEMINI_INPUT_RATE / DISCORD_RATE);
  const output = Buffer.allocUnsafe(outputFrames * 2);

  for (let frame = 0; frame < outputFrames; frame += 1) {
    const sourceFrame = frame * DISCORD_RATE / GEMINI_INPUT_RATE;
    const startFrame = Math.floor(sourceFrame);
    const endFrame = Math.min(completeFrames, Math.floor((frame + 1) * DISCORD_RATE / GEMINI_INPUT_RATE));
    let sum = 0;
    let count = 0;
    for (let index = startFrame; index < endFrame; index += 1) {
      const offset = index * DISCORD_CHANNELS * 2;
      sum += input.readInt16LE(offset);
      sum += input.readInt16LE(offset + 2);
      count += 2;
    }
    output.writeInt16LE(clampInt16(Math.round(sum / Math.max(count, 1))), frame * 2);
  }

  return output;
}

function upsampleGeminiPcmForDiscord(input: Buffer) {
  const inputFrames = Math.floor(input.length / 2);
  const outputFrames = Math.floor(inputFrames * DISCORD_RATE / GEMINI_OUTPUT_RATE);
  const output = Buffer.allocUnsafe(outputFrames * DISCORD_CHANNELS * 2);

  for (let frame = 0; frame < outputFrames; frame += 1) {
    const sourceFrame = Math.min(inputFrames - 1, Math.floor(frame * GEMINI_OUTPUT_RATE / DISCORD_RATE));
    const sample = input.readInt16LE(sourceFrame * 2);
    const offset = frame * DISCORD_CHANNELS * 2;
    output.writeInt16LE(sample, offset);
    output.writeInt16LE(sample, offset + 2);
  }

  return output;
}

function clampInt16(value: number) {
  return Math.max(-32768, Math.min(32767, value));
}
