import { loadConfig } from '../apps/server/src/config/env.ts';
import { exportLunaCharacterPack } from '../apps/server/src/training/exportLunaCharacterPack.ts';

const config = loadConfig();
const result = exportLunaCharacterPack(config);
console.log(`Exported Luna character pack for ${result.guildCount} guild(s) → ${result.filePath}`);
