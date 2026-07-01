import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(root);

const { loadConfig } = await import('../apps/server/src/config/env.ts');
const { exportLunaDataset } = await import('../apps/server/src/training/exportLunaDataset.ts');

const config = loadConfig();
const result = await exportLunaDataset(config);
console.log(`Luna dataset exported to ${result.outDir}`);
console.log(`  total: ${result.total}  train: ${result.train}  val: ${result.val}`);
