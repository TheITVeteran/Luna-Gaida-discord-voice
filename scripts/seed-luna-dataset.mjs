import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);

const { loadConfig } = await import('../apps/server/src/config/env.ts');
const { buildLunaSyntheticSeedRecords } = await import('../apps/server/src/training/lunaSyntheticSeed.ts');
const { exportLunaDataset } = await import('../apps/server/src/training/exportLunaDataset.ts');

const config = loadConfig();
const outDir = config.lunaTrainingDatasetDir;
mkdirSync(outDir, { recursive: true });

const seeds = buildLunaSyntheticSeedRecords();
const seedPath = join(outDir, 'synthetic-seed.jsonl');
writeFileSync(
  seedPath,
  `${seeds.map((record) => JSON.stringify(record)).join('\n')}\n`,
  'utf8'
);

const result = await exportLunaDataset(config);
console.log(`Wrote ${seeds.length} synthetic examples to ${seedPath}`);
console.log(`Luna dataset exported to ${result.outDir}`);
console.log(`  total: ${result.total}  train: ${result.train}  val: ${result.val}`);
