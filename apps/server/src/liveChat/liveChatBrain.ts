import type { AppConfig } from '../config/env.js';
import type { PersonalityInstructionProvider } from '../personality/service.js';
import type { LunaGoalsStore } from '../memory/lunaGoalsStore.js';
import type { LunaLifeStore } from '../memory/lunaLifeStore.js';
import type { LunaOpinionStore } from '../memory/lunaOpinionStore.js';
import type { LunaSelfConceptStore } from '../memory/lunaSelfConceptStore.js';
import {
  buildBatchCallerContextBlock,
  buildCallerContextBlocks,
  buildCallerFirstRule
} from '../memory/callerContext.js';
import type { UserVoiceMemoryStore } from '../memory/userVoiceMemory.js';
import { OllamaTextClient } from '../providers/ollamaText.js';
import { FISH_AUDIO_EXPRESSION_PROMPT } from '../live/fishAudioExpressions.js';
import { applyVoiceActionsToReply } from '../live/voiceActions.js';
import { sanitizeVoiceReply } from '../live/voiceReply.js';
import {
  formatLiveChatBatchPrompt,
  uniqueViewerNames,
  type LiveChatViewerLine
} from './liveChatBatch.js';
import { formatViewerRollCall } from './liveStreamSession.js';

export interface LiveChatReply {
  ttsText: string;
  displayText: string;
}

export interface LiveChatMemoryDeps {
  userVoiceMemory: UserVoiceMemoryStore;
  lunaLife: LunaLifeStore;
  lunaSelfConcept: LunaSelfConceptStore;
  lunaGoals: LunaGoalsStore;
  lunaOpinions: LunaOpinionStore;
}

export class LiveChatBrain {
  private readonly ollama: OllamaTextClient;
  private readonly history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private readonly useFishTts: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly personality: PersonalityInstructionProvider,
    private readonly memory: LiveChatMemoryDeps
  ) {
    this.ollama = new OllamaTextClient(config);
    this.useFishTts = config.LUNA_TTS_PROVIDER === 'fish' && Boolean(config.FISH_AUDIO_API_KEY?.trim());
  }

  async generateReply(platform: 'twitch' | 'youtube', author: string, text: string): Promise<LiveChatReply | null> {
    return this.generateReplyInternal(platform, {
      mode: 'single',
      author,
      text,
      viewers: [author]
    });
  }

  async generateBatchReply(
    platform: 'twitch' | 'youtube',
    messages: LiveChatViewerLine[]
  ): Promise<LiveChatReply | null> {
    if (!messages.length) return null;
    if (messages.length === 1) {
      const only = messages[0]!;
      return this.generateReply(platform, only.author, only.text);
    }

    const viewers = uniqueViewerNames(messages);
    const batchText = formatLiveChatBatchPrompt(messages);
    return this.generateReplyInternal(platform, {
      mode: 'batch',
      author: viewers.join(', '),
      text: batchText,
      viewers,
      messages
    });
  }

  private async generateReplyInternal(
    platform: 'twitch' | 'youtube',
    input: {
      mode: 'single' | 'batch';
      author: string;
      text: string;
      viewers: string[];
      messages?: LiveChatViewerLine[];
    }
  ): Promise<LiveChatReply | null> {
    const fishExpressionBlock = this.useFishTts ? `\n${FISH_AUDIO_EXPRESSION_PROMPT}` : '';
    const batchBlock = input.mode === 'batch'
      ? [
        `Several viewers messaged at once (${input.viewers.join(', ')}).`,
        'Reply ONCE for stream TTS — one cohesive line that acknowledges each person BY NAME.',
        'Briefly address what each said; do not answer only the last message.',
        'Keep it natural for live stream banter: 2–4 short sentences.',
        this.useFishTts
          ? 'Under 320 characters of spoken words (Fish tags do not count).'
          : 'Under 320 characters total.'
      ].join(' ')
      : null;

    const guildId = this.config.lunaLiveChatGuildId ?? null;
    const callerContext = input.mode === 'single'
      ? buildCallerContextBlocks({
        config: this.config,
        userVoiceMemory: this.memory.userVoiceMemory,
        lunaLife: this.memory.lunaLife,
        lunaSelfConcept: this.memory.lunaSelfConcept,
        lunaGoals: this.memory.lunaGoals,
        lunaOpinions: this.memory.lunaOpinions,
        guildId,
        displayName: input.author,
        userText: input.text,
        recentUserLines: input.mode === 'single' ? [input.text] : undefined
      })
      : null;
    const batchCallerBlock = input.mode === 'batch'
      ? buildBatchCallerContextBlock(this.memory.userVoiceMemory, this.config, input.viewers, guildId)
      : null;

    const system = [
      this.personality.buildInstruction('desktop', { nsfwAllowed: true }),
      buildCallerFirstRule(),
      'You are Luna replying in a live stream chat.',
      platform === 'youtube'
        ? 'YouTube chat is read aloud on stream via TTS — never type in YouTube chat.'
        : 'Twitch chat is read aloud on stream via TTS in the Fluffy avatar. Do not assume your words appear in Twitch chat unless asked.',
      input.mode === 'single'
        ? (this.useFishTts
          ? 'Keep replies short: one or two sentences, under 220 characters of spoken words (tags do not count). Use Fish bracket tags for emotion, pitch, pace, and tone.'
          : 'Keep replies short: one or two sentences, under 220 characters.')
        : batchBlock,
      'Be in character, warm and witty. No markdown.',
      'Name the viewer and reference what you know about them before anything else.',
      this.useFishTts
        ? 'Use *asterisk actions* for avatar motion and mirror the feeling with Fish tags in the spoken line.'
        : 'No asterisk stage directions.',
      'Do not say you are an AI or bot. Your name is Luna.',
      fishExpressionBlock,
      `Platform: ${platform}.`,
      input.mode === 'single' ? `Viewer: ${input.author}.` : `Viewers: ${input.viewers.join(', ')}.`,
      callerContext?.memoryBlock,
      callerContext?.conceptBlock,
      callerContext?.relationshipBlock,
      callerContext?.absenceBlock,
      callerContext?.socialToneBlock,
      batchCallerBlock,
      callerContext?.lifeBlock,
      callerContext?.selfConceptBlock,
      callerContext?.goalsBlock,
      callerContext?.opinionsBlock
    ].filter(Boolean).join('\n');

    const historyBlock = this.history
      .slice(-6)
      .map((entry) => `${entry.role === 'user' ? 'Viewer' : 'Luna'}: ${entry.content}`)
      .join('\n');

    const prompt = input.mode === 'batch'
      ? [
        historyBlock,
        'Multiple viewers just spoke:',
        input.text,
        'Give one combined on-stream reply that names them and covers their messages.'
      ].filter(Boolean).join('\n')
      : historyBlock
        ? `${historyBlock}\nViewer ${input.author}: ${input.text}`
        : `Viewer ${input.author}: ${input.text}`;

    const raw = await this.ollama.generate({
      system,
      userText: prompt,
      maxCompletionTokens: input.mode === 'batch'
        ? (this.useFishTts ? 260 : 200)
        : (this.useFishTts ? 180 : 120),
      temperature: 0.62
    });

    const cleaned = sanitizeVoiceReply(raw);
    if (!cleaned) return null;

    const { ttsText, displayText } = applyVoiceActionsToReply(cleaned, { fishTts: this.useFishTts });
    const maxChars = input.mode === 'batch' ? 320 : 220;
    const spoken = displayText.slice(0, maxChars).trim();
    if (!spoken && !ttsText.trim()) return null;

    const historyUser = input.mode === 'batch'
      ? `[${input.viewers.join(', ')}] ${input.messages!.map((message) => `${message.author}: ${message.text}`).join(' | ')}`
      : `${input.author}: ${input.text}`;
    this.history.push({ role: 'user', content: historyUser });
    this.history.push({ role: 'assistant', content: spoken });
    if (this.history.length > 20) {
      this.history.splice(0, this.history.length - 20);
    }

    return { ttsText: ttsText || spoken, displayText: spoken };
  }

  async generateStreamIntro(platform: 'youtube'): Promise<LiveChatReply | null> {
    const fishExpressionBlock = this.useFishTts ? `\n${FISH_AUDIO_EXPRESSION_PROMPT}` : '';
    const host = this.config.lunaCreatorName?.trim() || 'the stream';
    const system = [
      this.personality.buildInstruction('desktop', { nsfwAllowed: true }),
      'You are Luna on a live YouTube stream. The broadcast just went live.',
      'Give a warm on-stream INTRO spoken aloud via TTS — welcome chat, set the vibe, mention you are happy to be here with them.',
      `You are co-hosting with ${host}. Do not read chat messages yet — this is your opening line only.`,
      this.useFishTts
        ? 'One or two sentences, under 280 characters of spoken words. Use Fish bracket tags for energy and tone.'
        : 'One or two sentences, under 280 characters.',
      'No markdown. Do not say you are an AI.',
      fishExpressionBlock,
      `Platform: ${platform}.`
    ].filter(Boolean).join('\n');

    const raw = await this.ollama.generate({
      system,
      userText: 'The YouTube stream is live. Give your intro now.',
      maxCompletionTokens: this.useFishTts ? 220 : 160,
      temperature: 0.75
    });

    return this.finalizeProactiveReply(raw, 280);
  }

  async generateStreamOutro(
    platform: 'youtube',
    viewers: string[],
    streamMinutes: number
  ): Promise<LiveChatReply | null> {
    const fishExpressionBlock = this.useFishTts ? `\n${FISH_AUDIO_EXPRESSION_PROMPT}` : '';
    const rollCall = formatViewerRollCall(viewers);
    const host = this.config.lunaCreatorName?.trim() || 'everyone';
    const system = [
      this.personality.buildInstruction('desktop', { nsfwAllowed: true }),
      'You are Luna wrapping up a live YouTube stream segment on-air via TTS.',
      `The stream has been running about ${streamMinutes} minutes — time for an OUTRO.`,
      'Thank people BY NAME when you have names. Acknowledge the chat energy warmly.',
      'Include a gentle call to action: like, subscribe, or follow so they catch the next stream.',
      'End with that you will see them soon — warm, not cheesy.',
      viewers.length
        ? `Viewers you spoke with in chat: ${rollCall}.`
        : 'You did not get many named chats — thank the room generally.',
      this.useFishTts
        ? 'Three to five short sentences max, under 420 characters of spoken words. Fish tags for warmth.'
        : 'Three to five short sentences max, under 420 characters.',
      'No markdown. Do not say you are an AI.',
      fishExpressionBlock,
      `Platform: ${platform}. Host: ${host}.`
    ].filter(Boolean).join('\n');

    const raw = await this.ollama.generate({
      system,
      userText: 'Give your stream outro now — thank chat, call to action, see them soon.',
      maxCompletionTokens: this.useFishTts ? 320 : 240,
      temperature: 0.72
    });

    return this.finalizeProactiveReply(raw, 420);
  }

  private finalizeProactiveReply(raw: string, maxChars: number): LiveChatReply | null {
    const cleaned = sanitizeVoiceReply(raw);
    if (!cleaned) return null;

    const { ttsText, displayText } = applyVoiceActionsToReply(cleaned, { fishTts: this.useFishTts });
    const spoken = displayText.slice(0, maxChars).trim();
    if (!spoken && !ttsText.trim()) return null;

    return { ttsText: ttsText || spoken, displayText: spoken };
  }
}
