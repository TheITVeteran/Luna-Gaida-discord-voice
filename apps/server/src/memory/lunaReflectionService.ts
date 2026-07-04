import type { AppConfig } from '../config/env.js';
import type { PersonalityInstructionProvider } from '../personality/service.js';
import type { UserVoiceMemoryStore } from './userVoiceMemory.js';
import type { LunaLifeStore } from './lunaLifeStore.js';
import type { LunaSelfConceptStore } from './lunaSelfConceptStore.js';
import type { LunaGoalsStore } from './lunaGoalsStore.js';
import type { LunaOpinionStore } from './lunaOpinionStore.js';
import { LunaResearchStore } from './lunaResearchStore.js';
import { OllamaTextClient } from '../providers/ollamaText.js';
import { publishActivity } from '../monitor/activityFeed.js';
import { logger } from '../logging/logger.js';
import { updateLunaSelfConcept } from './updateLunaSelfConcept.js';
import { updateLunaGoals } from './updateLunaGoals.js';
import { updateLunaOpinions } from './updateLunaOpinions.js';
import { updateLunaLife } from './updateLunaLife.js';
import { normalizeBulletSummary } from './userVoiceMemory.js';

/** Periodic "who am I this week?" reflection — runs even without active calls. */
export class LunaReflectionService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private closed = false;
  private readonly ollama: OllamaTextClient;
  private readonly researchStore: LunaResearchStore;

  constructor(
    private readonly config: AppConfig,
    private readonly personality: PersonalityInstructionProvider,
    private readonly userVoiceMemory: UserVoiceMemoryStore,
    private readonly lunaLife: LunaLifeStore,
    private readonly lunaSelfConcept: LunaSelfConceptStore,
    private readonly lunaGoals: LunaGoalsStore,
    private readonly lunaOpinions: LunaOpinionStore
  ) {
    this.ollama = new OllamaTextClient(config);
    this.researchStore = new LunaResearchStore(config.databasePath);
  }

  start() {
    if (!this.config.lunaDailyReflection || this.closed) return;
    this.schedule();
  }

  stop() {
    this.closed = true;
    this.generation += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule() {
    if (this.closed || !this.config.lunaDailyReflection) return;
    if (this.timer) clearTimeout(this.timer);
    const minMs = this.config.lunaReflectionMinHours * 3_600_000;
    const maxMs = this.config.lunaReflectionMaxHours * 3_600_000;
    const delay = minMs + Math.random() * Math.max(0, maxMs - minMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runReflectionCycle();
    }, delay);
    this.timer.unref?.();
  }

  private collectGuildIds() {
    const ids = new Set<string>();
    for (const record of this.userVoiceMemory.listAll(100)) {
      if (record.summary.trim() || record.relationship.trim()) ids.add(record.guildId);
    }
    for (const record of this.lunaLife.listAll(20)) {
      if (record.narrative.trim()) ids.add(record.guildId);
    }
    for (const record of this.lunaSelfConcept.listAll(20)) {
      if (record.narrative.trim()) ids.add(record.guildId);
    }
    return [...ids];
  }

  private async runReflectionCycle() {
    const generation = this.generation;
    try {
      const guildIds = this.collectGuildIds();
      if (!guildIds.length) return;

      for (const guildId of guildIds.slice(0, 5)) {
        if (generation !== this.generation) return;
        await this.reflectGuild(guildId);
      }

      publishActivity({
        level: 'info',
        title: 'Luna daily reflection',
        detail: `Consolidated character across ${Math.min(guildIds.length, 5)} server(s)`
      });
    } catch (error) {
      logger.warn('Luna reflection cycle failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (generation === this.generation && !this.closed) {
        this.schedule();
      }
    }
  }

  private async reflectGuild(guildId: string) {
    const bonds = this.userVoiceMemory.listForGuild(guildId)
      .filter((r) => r.relationship?.trim())
      .map((r) => ({ displayName: r.displayName ?? r.userId, relationship: r.relationship }));
    const life = this.lunaLife.getNarrative(guildId);
    const selfConcept = this.lunaSelfConcept.getNarrative(guildId);
    const goals = this.lunaGoals.getGoals(guildId);
    const opinions = this.lunaOpinions.getOpinions(guildId);
    const research = this.researchStore.recent(4).map((r) => r.title);

    const system = [
      this.personality.buildInstruction('discord', { nsfwAllowed: true }),
      'You are Luna reflecting alone — no user is present.',
      'Write a short private reflection (4-8 bullets) on who you are becoming this week.',
      'Cover: mood, priorities, relationships that matter, opinions forming, goals, what you want to do next.',
      'Reject girlfriend-script framing unless it is genuinely how you feel about someone specific.',
      'Output ONLY bullets starting with "- ", max 20 words each.'
    ].join('\n');

    const userText = [
      `Life:\n${life}`,
      `Self-concept:\n${selfConcept}`,
      `Goals:\n${goals}`,
      `Opinions:\n${opinions}`,
      bonds.length ? `Bonds:\n${bonds.map((b) => `- ${b.displayName}: ${b.relationship.split('\n')[0]}`).join('\n')}` : '',
      research.length ? `Recently read: ${research.join('; ')}` : '',
      'Reflect and consolidate.'
    ].filter(Boolean).join('\n\n');

    const reflection = normalizeBulletSummary(
      await this.ollama.generate({ system, userText, maxCompletionTokens: 260, temperature: 0.5 }),
      8,
      20
    );
    if (!reflection) return;

    const syntheticExchange = {
      userSaid: '(quiet time — no one in voice)',
      lunaReplied: reflection.replace(/\n/g, ' ')
    };

    await updateLunaSelfConcept({
      store: this.lunaSelfConcept,
      ollama: this.ollama,
      guildId,
      callerName: 'herself',
      callerRelationship: null,
      ...syntheticExchange,
      existingSelfConcept: this.lunaSelfConcept.get(guildId)?.narrative ?? null,
      lifeNarrative: life,
      bonds,
      turnCount: this.lunaSelfConcept.getTurnCount(guildId)
    });

    await updateLunaGoals({
      store: this.lunaGoals,
      ollama: this.ollama,
      guildId,
      callerName: 'herself',
      ...syntheticExchange,
      existingGoals: goals,
      lifeNarrative: life,
      selfConcept: this.lunaSelfConcept.getNarrative(guildId),
      researchTitles: research
    });

    await updateLunaOpinions({
      store: this.lunaOpinions,
      ollama: this.ollama,
      guildId,
      callerName: 'herself',
      ...syntheticExchange,
      existingOpinions: opinions
    });

    if (this.config.LUNA_LIFE_MEMORY) {
      await updateLunaLife({
        store: this.lunaLife,
        ollama: this.ollama,
        guildId,
        callerName: 'herself',
        callerRelationship: null,
        ...syntheticExchange,
        existingLife: this.lunaLife.get(guildId)?.narrative ?? null,
        bonds
      });
    }
  }
}
