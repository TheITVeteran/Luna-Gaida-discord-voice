import type { AppConfig } from '../config/env.js';
import type { PersonalityInstructionProvider } from '../personality/service.js';
import { publishActivity } from '../monitor/activityFeed.js';
import { logger } from '../logging/logger.js';
import { LiveChatBrain } from './liveChatBrain.js';
import {
  formatLiveChatBatchPrompt,
  liveChatBatchFlushDelayMs,
  uniqueViewerNames
} from './liveChatBatch.js';
import { TwitchChatClient } from './twitchChatClient.js';
import { YoutubeChatWorker } from './youtubeChatWorker.js';

type Platform = 'twitch' | 'youtube';

interface IncomingChatMessage {
  platform: Platform;
  id: string;
  author: string;
  text: string;
}

export interface LiveChatCoordinatorOptions {
  speakTts?: (text: string, options?: { displayText?: string }) => Promise<boolean>;
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
  private warnedLiveTts = false;

  constructor(
    private readonly config: AppConfig,
    personality: PersonalityInstructionProvider,
    private readonly options: LiveChatCoordinatorOptions = {}
  ) {
    this.twitch = new TwitchChatClient(config);
    this.youtube = new YoutubeChatWorker(config);
    this.brain = new LiveChatBrain(config, personality);
    this.twitch.onMessage((message) => {
      void this.handleMessage(message);
    });
    this.youtube.onMessage((message) => {
      void this.handleMessage(message);
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

      const reply = batch.length === 1
        ? await this.brain.generateReply(platform, batch[0]!.author, batch[0]!.text)
        : await this.brain.generateBatchReply(platform, viewerLines);

      if (!reply) {
        logger.warn('Live chat brain returned no reply', {
          platform,
          viewers: uniqueViewerNames(viewerLines),
          count: batch.length
        });
        return;
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

      if (platform === 'twitch' && this.config.twitchChatReply) {
        await this.twitch.reply(reply.displayText);
      }

      const names = uniqueViewerNames(viewerLines);
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
          ...(this.config.twitchChatReply && platform === 'twitch' ? { twitchChat: true } : {})
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
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
