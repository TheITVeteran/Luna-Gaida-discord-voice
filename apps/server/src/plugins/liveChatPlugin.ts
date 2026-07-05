import type { GiadaPlugin } from './plugin.js';
import type { AppConfig } from '../config/env.js';
import type { PersonalityInstructionProvider } from '../personality/service.js';
import type { AvatarTtsService } from '../live/avatarTtsService.js';
import { logger } from '../logging/logger.js';
import { LiveChatCoordinator } from '../liveChat/liveChatCoordinator.js';
import type { LunaGoalsStore } from '../memory/lunaGoalsStore.js';
import type { LunaLifeStore } from '../memory/lunaLifeStore.js';
import type { LunaOpinionStore } from '../memory/lunaOpinionStore.js';
import type { LunaSelfConceptStore } from '../memory/lunaSelfConceptStore.js';
import type { UserVoiceMemoryStore } from '../memory/userVoiceMemory.js';
import type { DiscordPlugin } from './discord/discordPlugin.js';

export class LiveChatPlugin implements GiadaPlugin {
  name = 'live-chat';
  private coordinator: LiveChatCoordinator | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly personality: PersonalityInstructionProvider,
    private readonly memory: {
      userVoiceMemory: UserVoiceMemoryStore;
      lunaLife: LunaLifeStore;
      lunaSelfConcept: LunaSelfConceptStore;
      lunaGoals: LunaGoalsStore;
      lunaOpinions: LunaOpinionStore;
    },
    private readonly discord?: DiscordPlugin,
    private readonly avatarTts?: AvatarTtsService | null
  ) {}

  async start() {
    const enabled = this.config.twitchLiveChat
      || (this.config.youtubeLiveChat && Boolean(this.config.youtubeCheckUrl));
    if (!enabled) {
      logger.info('Live chat plugin disabled (no Twitch/YouTube config)');
      return;
    }

    this.coordinator = new LiveChatCoordinator(this.config, this.personality, {
      memory: this.memory,
      speakTts: async (text, options) => {
        if (this.avatarTts) {
          const result = await this.avatarTts.speakLine(text, { publish: false, ...options });
          if (result.playbackMs > 0) {
            return true;
          }
        }
        if (await this.discord?.speakLiveChatTts(text, options)) {
          return true;
        }
        return false;
      },
      postDiscordText: async (text) => this.discord?.postLiveChatTextReply(text) ?? false
    });
    await this.coordinator.start();
    logger.info('Live chat plugin started', {
      twitch: this.config.twitchLiveChat,
      youtube: this.config.youtubeLiveChat,
      youtubeMode: 'read-tts'
    });
  }

  async stop() {
    await this.coordinator?.stop();
    this.coordinator = null;
  }
}
