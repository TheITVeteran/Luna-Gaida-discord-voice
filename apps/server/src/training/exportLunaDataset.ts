import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { AppConfig } from '../config/env.js';
import { buildLunaSyntheticSeedRecords } from './lunaSyntheticSeed.js';
import type { LunaTrainingRecord } from './lunaDatasetTypes.js';
import { lunaTrainingRecordSchema } from './lunaDatasetTypes.js';

export interface ExportLunaDatasetOptions {
  includeSynthetic?: boolean;
  valRatio?: number;
}

export async function exportLunaDataset(config: AppConfig, options: ExportLunaDatasetOptions = {}) {
  const includeSynthetic = options.includeSynthetic ?? true;
  const valRatio = Math.min(0.4, Math.max(0.05, options.valRatio ?? 0.1));

  const outDir = config.lunaTrainingDatasetDir;
  mkdirSync(outDir, { recursive: true });

  const records = new Map<string, LunaTrainingRecord>();

  await loadJsonlRecords(join(outDir, 'luna-turns.jsonl'), records);

  if (includeSynthetic) {
    const seedPath = join(outDir, 'synthetic-seed.jsonl');
    if (existsSync(seedPath)) {
      await loadJsonlRecords(seedPath, records);
    } else {
      for (const seed of buildLunaSyntheticSeedRecords()) {
        records.set(seed.id, seed);
      }
    }
  }

  const all = [...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shuffled = shuffleStable(all);
  const valCount = Math.max(1, Math.round(shuffled.length * valRatio));
  const val = shuffled.slice(0, valCount);
  const train = shuffled.slice(valCount);

  writeJsonl(join(outDir, 'train.jsonl'), train);
  writeJsonl(join(outDir, 'val.jsonl'), val);
  writeJsonl(join(outDir, 'all.jsonl'), all);
  writeFileSync(join(outDir, 'dataset-stats.json'), JSON.stringify({
    total: all.length,
    train: train.length,
    val: val.length,
    bySource: countBySource(all),
    exportedAt: new Date().toISOString(),
  }, null, 2));

  return { outDir, total: all.length, train: train.length, val: val.length };
}

async function loadJsonlRecords(filePath: string, records: Map<string, LunaTrainingRecord>) {
  if (!existsSync(filePath)) return;
  const stream = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity });
  for await (const line of stream) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = lunaTrainingRecordSchema.parse(JSON.parse(trimmed));
      records.set(parsed.id, parsed);
    } catch {
      // skip malformed lines
    }
  }
}

function writeJsonl(filePath: string, records: LunaTrainingRecord[]) {
  const body = records.map((record) => JSON.stringify(record)).join('\n');
  writeFileSync(filePath, body ? `${body}\n` : '', 'utf8');
}

function countBySource(records: LunaTrainingRecord[]) {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.source] = (counts[record.source] ?? 0) + 1;
  }
  return counts;
}

function shuffleStable<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor((i + 1) * 0.71) % (i + 1);
    const left = copy[i]!;
    const right = copy[j]!;
    copy[i] = right;
    copy[j] = left;
  }
  return copy;
}

export function readDatasetStats(datasetDir: string) {
  const statsPath = join(datasetDir, 'dataset-stats.json');
  if (!existsSync(statsPath)) return null;
  return JSON.parse(readFileSync(statsPath, 'utf8')) as Record<string, unknown>;
}
