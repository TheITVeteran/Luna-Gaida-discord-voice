import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/env.js';
import { logger } from '../logging/logger.js';
import type { LunaTrainingRecord } from './lunaDatasetTypes.js';
import { lunaTrainingRecordSchema } from './lunaDatasetTypes.js';

export class LunaDatasetLogger {
  private readonly enabled: boolean;
  private readonly directory: string;

  constructor(config: AppConfig) {
    this.enabled = config.lunaTrainingLog;
    this.directory = config.lunaTrainingDatasetDir;
    if (this.enabled) {
      mkdirSync(this.directory, { recursive: true });
    }
  }

  log(record: LunaTrainingRecord) {
    if (!this.enabled) return;
    try {
      const parsed = lunaTrainingRecordSchema.parse(record);
      const filePath = join(this.directory, 'luna-turns.jsonl');
      appendFileSync(filePath, `${JSON.stringify(parsed)}\n`, 'utf8');
    } catch (error) {
      logger.warn('Could not append Luna training record', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
