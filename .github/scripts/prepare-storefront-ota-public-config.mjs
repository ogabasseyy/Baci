import { readFile, writeFile } from 'node:fs/promises';
import { preserveTiktokCapability } from './storefront-ota-public-config.mjs';

const [configPath, currentTiktokCapability] = process.argv.slice(2);
if (!configPath) throw new Error('A public Expo config path is required.');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const safeConfig = preserveTiktokCapability(config, currentTiktokCapability);
await writeFile(configPath, `${JSON.stringify(safeConfig)}\n`);
