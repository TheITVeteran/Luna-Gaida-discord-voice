import type { AppConfig } from '../config/env.js';
import { isLiveChatTextRepliesEnabled } from '../live/lunaTtsOutput.js';
import type { PersonalityInstructionProvider } from '../personality/service.js';
import { publishActivity } from '../monitor/activityFeed.js';
import { logger } from '../logging/logger.js';
import { LiveChatBrain, type LiveChatMemoryDeps } from './liveChatBrain.js';
import {
  formatLiveChatBatchPrompt,
  liveChatBatchFlushDelayMs,
  uniqueViewerNames
} from './liveChatBatch.js';
import {
  shouldSkipIntro,
  YoutubeLiveStreamSession
} from './liveStreamSession.js';
import { TwitchChatClient } from './twitchChatClient.js';
import { YoutubeChatWorker } from './youtubeChatWorker.js';

const YOUTUBE_OFFLINE_GRACE_MS = 25_000;

type Platform = 'twitch' | 'youtube';

interface IncomingChatMessage {
  platform: Platform;
  id: string;
  author: string;
  text: string;
}

export interface LiveChatCoordinatorOptions {
  speakTts?: (text: string, options?: { displayText?: string }) => Promise<boolean>;
  postDiscordText?: (text: string) => Promise<boolean>;
  memory: LiveChatMemoryDeps;
}

export class LiveChatCoordinator {
  private readonly brain: LiveChatBrain;
  private readonly twitch: TwitchChatClient;
  private readonly youtube: YoutubeChatWorker;
  private readonly seenIds = new Set<string>();
  private readonly inbox: IncomingChatMessage[] = [];
  private replyChain: Promise<void> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReplyEndedAt = 0;
  private started = false;
  private youtubeRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private youtubeOfflineTimer: ReturnType<typeof setTimeout> | null = null;
  private youtubeSession: YoutubeLiveStreamSession | null = null;
  private warnedLiveTts = false;
  private warnedYoutubeChatText = false;

  constructor(
    private readonly config: AppConfig,
    personality: PersonalityInstructionProvider,
    private readonly options: LiveChatCoordinatorOptions
  ) {
    this.twitch = new TwitchChatClient(config);
    this.youtube = new YoutubeChatWorker(config);
    this.brain = new LiveChatBrain(config, personality, options.memory);
    this.twitch.onMessage((message) => {
      void this.handleMessage(message);
    });
    this.youtube.onMessage((message) => {
      void this.handleMessage(message);
    });
    this.youtube.onLifecycle((event) => {
      void this.handleYoutubeLifecycle(event);
    });
  }

  async start() {
    if (this.started) return;
    this.started = true;

    if (this.config.twitchLiveChat) {
      await this.twitch.start();
      publishActivity({
        level: 'success',
        title: 'Twitch chat',
        detail: `Listening in #${this.config.twitchChannel}`
      });
    }

    if (this.config.youtubeLiveChat && this.config.youtubeCheckUrl) {
      await this.startYoutubeWithRetry();
    }
  }

  async stop() {
    this.started = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.youtubeRestartTimer) {
      clearTimeout(this.youtubeRestartTimer);
      this.youtubeRestartTimer = null;
    }
    if (this.youtubeOfflineTimer) {
      clearTimeout(this.youtubeOfflineTimer);
      this.youtubeOfflineTimer = null;
    }
    this.youtubeSession?.clearOutroTimer();
    this.youtubeSession = null;
    await Promise.allSettled([this.twitch.close(), this.youtube.close()]);
  }

  private async startYoutubeWithRetry() {
    try {
      await this.youtube.start();
      publishActivity({
        level: 'success',
        title: 'YouTube live chat (read → TTS)',
        detail: this.config.youtubeCheckUrl ?? ''
      });
    } catch (error) {
      logger.error('Failed to start YouTube live chat', {
        error: error instanceof Error ? error.message : String(error)
      });
      publishActivity({
        level: 'error',
        title: 'YouTube live chat failed',
        detail: error instanceof Error ? error.message : String(error)
      });
      if (this.started) {
        this.youtubeRestartTimer = setTimeout(() => {
          this.youtubeRestartTimer = null;
          void this.startYoutubeWithRetry();
        }, 30_000);
      }
    }
  }

  private handleMessage(message: IncomingChatMessage) {
    if (!message.id || this.seenIds.has(message.id)) return;
    this.seenIds.add(message.id);
    if (this.seenIds.size > 5000) {
      this.seenIds.clear();
    }

    publishActivity({
      level: 'user',
      title: `${message.platform} · ${message.author}`,
      detail: message.text,
      meta: { platform: message.platform }
    });

    const autoReply = message.platform === 'twitch'
      ? this.config.twitchAutoReply
      : this.config.youtubeAutoReply;
    if (!autoReply) {
      logger.debug('Live chat message ignored (auto-reply off)', {
        platform: message.platform,
        author: message.author
      });
      return;
    }

    const trigger = message.platform === 'twitch'
      ? this.config.twitchAutoTrigger
      : this.config.youtubeAutoTrigger;
    const skipReason = this.replySkipReason(message.platform, trigger, message.text, message.author);
    if (skipReason) {
      logger.debug('Live chat message ignored', {
        platform: message.platform,
        author: message.author,
        reason: skipReason
      });
      return;
    }

    this.inbox.push(message);
    this.scheduleInboxFlush();
  }

  private scheduleInboxFlush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    const delay = liveChatBatchFlushDelayMs(
      this.inbox.length,
      this.config.lunaLiveChatBatchMs,
      this.config.lunaLiveChatMaxBatch
    );
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushInbox();
    }, delay);
    this.flushTimer.unref?.();
  }

  private flushInbox() {
    if (!this.inbox.length) return;

    const batch = this.inbox.splice(0, this.config.lunaLiveChatMaxBatch);
    if (this.inbox.length) {
      this.scheduleInboxFlush();
    }

    this.replyChain = this.replyChain
      .then(() => this.processBatch(batch))
      .catch((error) => {
        logger.warn('Live chat batch failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  private async processBatch(batch: IncomingChatMessage[]) {
    if (!batch.length) return;

    const platform = batch[0]!.platform;
    try {
      await this.waitForReplyGap();

      const viewerLines = batch.map((message) => ({
        author: message.author,
        text: message.text
      }));

      const names = uniqueViewerNames(viewerLines);

      const reply = batch.length === 1
        ? await this.brain.generateReply(platform, batch[0]!.author, batch[0]!.text)
        : await this.brain.generateBatchReply(platform, viewerLines);

      if (!reply) {
        logger.warn('Live chat brain returned no reply', {
          platform,
          viewers: names,
          count: batch.length
        });
        return;
      }

      if (platform === 'youtube' && this.youtubeSession) {
        this.youtubeSession.noteViewers(names);
      }

      const wantsTts = platform === 'youtube'
        ? this.config.youtubeTts
        : this.config.twitchTts;
      if (wantsTts) {
        const spoke = await this.options.speakTts?.(reply.ttsText, { displayText: reply.displayText }) ?? false;
        if (!spoke && !this.warnedLiveTts) {
          this.warnedLiveTts = true;
          logger.warn('Live chat TTS skipped', { platform });
          publishActivity({
            level: 'warn',
            title: `${platform} TTS unavailable`,
            detail: 'Reply was generated but could not be spoken. Open Fluffy (Electron) or join Luna to a Discord voice channel.'
          });
        }
      }

      await this.postChatTextReplies(platform, reply.displayText);

      publishActivity({
        level: 'assistant',
        title: batch.length > 1
          ? `Luna spoke (${platform} · ${batch.length} chatters)`
          : platform === 'youtube'
            ? 'Luna spoke (YouTube TTS)'
            : 'Luna spoke (Twitch TTS)',
        detail: reply.displayText,
        meta: {
          platform,
          to: names.join(', '),
          batchSize: batch.length,
          mode: wantsTts ? 'tts' : 'chat',
          chatText: this.wantsChatTextReply(platform)
        }
      });
    } catch (error) {
      logger.warn('Live chat reply failed', {
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      this.lastReplyEndedAt = Date.now();
    }
  }

  private async waitForReplyGap() {
    const gapMs = this.config.lunaLiveChatMinGapMs;
    if (!gapMs || !this.lastReplyEndedAt) return;
    const elapsed = Date.now() - this.lastReplyEndedAt;
    if (elapsed < gapMs) {
      await delay(gapMs - elapsed);
    }
  }

  private replySkipReason(platform: Platform, trigger: string, text: string, author: string) {
    if (platform === 'twitch') {
      const botUsername = this.config.twitchUsername?.toLowerCase().replace(/^@/, '');
      const authorKey = author.toLowerCase().replace(/^@/, '');
      if (botUsername && authorKey === botUsername) {
        return 'ignored_bot_account';
      }
    }

    const normalized = text.trim();
    if (!normalized) return 'empty_message';

    if (trigger === 'all') return null;
    if (trigger === 'mention') {
      return (/\bluna\b/i.test(normalized) || /@luna\b/i.test(normalized)) ? null : 'trigger_mention';
    }
    if (trigger === 'question') {
      return normalized.includes('?') ? null : 'trigger_question';
    }
    return /\bluna\b/i.test(normalized) ? null : 'trigger_luna';
  }

  private handleYoutubeLifecycle(event: { type: 'live_ready' | 'offline'; videoId: string | null }) {
    if (event.type === 'live_ready') {
      this.cancelYoutubeOfflineGrace();
      if (event.videoId) {
        void this.onYoutubeLiveReady(event.videoId);
      }
      return;
    }
    this.scheduleYoutubeOffline(event.videoId);
  }

  private cancelYoutubeOfflineGrace() {
    if (this.youtubeOfflineTimer) {
      clearTimeout(this.youtubeOfflineTimer);
      this.youtubeOfflineTimer = null;
    }
  }

  private scheduleYoutubeOffline(videoId: string | null) {
    this.cancelYoutubeOfflineGrace();
    this.youtubeOfflineTimer = setTimeout(() => {
      this.youtubeOfflineTimer = null;
      void this.onYoutubeLiveOffline(videoId);
    }, YOUTUBE_OFFLINE_GRACE_MS);
    this.youtubeOfflineTimer.unref?.();
  }

  private async onYoutubeLiveReady(videoId: string) {
    if (shouldSkipIntro(this.youtubeSession, videoId)) {
      logger.info('YouTube live chat reconnected (same stream)', { videoId });
      return;
    }

    if (this.youtubeSession && this.youtubeSession.videoId !== videoId) {
      await this.maybePlayStreamOutro('stream_change');
      this.youtubeSession.clearOutroTimer();
      this.youtubeSession = null;
    }

    const session = new YoutubeLiveStreamSession(videoId);
    this.youtubeSession = session;

    publishActivity({
      level: 'success',
      title: 'YouTube stream live',
      detail: `Broadcast ${videoId} — Luna is on air`,
      meta: { videoId, platform: 'youtube' }
    });

    if (this.config.youtubeLiveIntro) {
      this.replyChain = this.replyChain
        .then(() => this.playStreamIntro(session))
        .catch((error) => {
          logger.warn('YouTube stream intro failed', {
            error: error instanceof Error ? error.message : String(error)
          });
        });
    } else {
      session.introDone = true;
    }

    if (this.config.youtubeLiveOutro) {
      const outroMs = this.config.youtubeLiveOutroAfterMin * 60_000;
      session.scheduleOutro(outroMs, () => {
        this.replyChain = this.replyChain
          .then(() => this.maybePlayStreamOutro('scheduled'))
          .catch((error) => {
            logger.warn('YouTube scheduled stream outro failed', {
              error: error instanceof Error ? error.message : String(error)
            });
          });
      });
    }
  }

  private async onYoutubeLiveOffline(videoId: string | null) {
    const session = this.youtubeSession;
    if (!session) return;
    if (videoId && session.videoId !== videoId) return;

    publishActivity({
      level: 'info',
      title: 'YouTube stream ended',
      detail: session.videoId,
      meta: { videoId: session.videoId, platform: 'youtube' }
    });

    session.clearOutroTimer();
    const elapsedMin = session.elapsedMinutes();
    if (
      this.config.youtubeLiveOutro
      && !session.outroDone
      && elapsedMin >= this.config.youtubeLiveOutroAfterMin
    ) {
      await this.replyChain.then(() => this.maybePlayStreamOutro('stream_end'));
    }

    this.youtubeSession = null;
  }

  private async playStreamIntro(session: YoutubeLiveStreamSession) {
    if (session.introDone || session.outroDone) return;

    const reply = await this.brain.generateStreamIntro('youtube');
    if (!reply) {
      logger.warn('YouTube stream intro generation returned empty');
      session.introDone = true;
      return;
    }

    await this.speakLiveChatLine('youtube', reply, {
      activityTitle: 'Luna stream intro (YouTube)',
      meta: { segment: 'intro', videoId: session.videoId }
    });
    session.introDone = true;
  }

  private async maybePlayStreamOutro(reason: 'scheduled' | 'stream_end' | 'stream_change') {
    const session = this.youtubeSession;
    if (!session || session.outroDone || !this.config.youtubeLiveOutro) return;

    session.outroDone = true;
    session.clearOutroTimer();

    const viewers = session.getViewers();
    const streamMinutes = session.elapsedMinutes();
    const reply = await this.brain.generateStreamOutro('youtube', viewers, streamMinutes);
    if (!reply) {
      logger.warn('YouTube stream outro generation returned empty', { reason });
      return;
    }

    await this.speakLiveChatLine('youtube', reply, {
      activityTitle: reason === 'scheduled'
        ? 'Luna stream outro (YouTube · 2h)'
        : 'Luna stream outro (YouTube · sign-off)',
      meta: {
        segment: 'outro',
        reason,
        videoId: session.videoId,
        viewers: viewers.length,
        streamMinutes
      }
    });
  }

  private async speakLiveChatLine(
    platform: 'youtube' | 'twitch',
    reply: { ttsText: string; displayText: string },
    options: { activityTitle: string; meta?: Record<string, unknown> }
  ) {
    const wantsTts = platform === 'youtube' ? this.config.youtubeTts : this.config.twitchTts;
    if (wantsTts) {
      const spoke = await this.options.speakTts?.(reply.ttsText, { displayText: reply.displayText }) ?? false;
      if (!spoke && !this.warnedLiveTts) {
        this.warnedLiveTts = true;
        logger.warn('Live chat TTS skipped', { platform, segment: options.meta?.segment });
        publishActivity({
          level: 'warn',
          title: `${platform} TTS unavailable`,
          detail: 'Segment was generated but could not be spoken. Open Fluffy (Electron) or join Luna to a Discord voice channel.'
        });
      }
    }

    publishActivity({
      level: 'assistant',
      title: options.activityTitle,
      detail: reply.displayText,
      meta: { platform, mode: wantsTts ? 'tts' : 'text', ...options.meta }
    });

    await this.postChatTextReplies(platform, reply.displayText);
  }

  private wantsChatTextReply(platform: Platform) {
    if (isLiveChatTextRepliesEnabled()) {
      return true;
    }
    return platform === 'twitch' && this.config.twitchChatReply;
  }

  private async postChatTextReplies(platform: Platform, text: string) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized || !this.wantsChatTextReply(platform)) {
      return;
    }

    if (platform === 'twitch') {
      await this.twitch.reply(normalized);
    }

    if (platform === 'youtube' && isLiveChatTextRepliesEnabled() && !this.warnedYoutubeChatText) {
      this.warnedYoutubeChatText = true;
      logger.info('YouTube live chat is read-only — voice reply only (Fluffy Electron)');
      publishActivity({
        level: 'info',
        title: 'YouTube chat text',
        detail: 'YouTube live chat cannot be typed into from Luna. Replies are spoken on stream via Fluffy.'
      });
    }

    if (isLiveChatTextRepliesEnabled()) {
      try {
        await this.options.postDiscordText?.(normalized);
      } catch (error) {
        logger.warn('Discord live chat text reply failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
