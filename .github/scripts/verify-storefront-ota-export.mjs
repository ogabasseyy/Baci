import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertNoPrivateValues,
  validateExportMetadata,
  validateOtaConfig,
} from './storefront-ota-export-validation.mjs';

const [directory, runtimeVersion, sourceSha, mode, ...extraArgs] = process.argv.slice(2);
if (!directory || !runtimeVersion || !sourceSha || (mode && mode !== '--public-only') || extraArgs.length) {
  throw new Error('Usage: verify-storefront-ota-export <directory> <runtime> <commit> [--public-only]');
}
const config = JSON.parse(await readFile(path.join(directory, 'expo-config.json'), 'utf8'));
validateOtaConfig(config, runtimeVersion);
await validateExportMetadata(path.join(directory, 'dist'), sourceSha);
const provenance = { platform: 'ios', runtimeVersion, sourceSha };
const provenancePath = path.join(directory, 'provenance.json');
if (mode === '--public-only') {
  const recorded = JSON.parse(await readFile(provenancePath, 'utf8'));
  if (Object.keys(provenance).some((key) => recorded[key] !== provenance[key])) {
    throw new Error('Export provenance does not match the selected update.');
  }
  console.log('Private values were not scanned locally; rely on the verified workflow run.');
} else {
  await assertNoPrivateValues(directory, {
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    STOREFRONT_TIKTOK_APP_SECRET: process.env.STOREFRONT_TIKTOK_APP_SECRET,
  });
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
}
console.log(`Verified iOS OTA export for runtime ${runtimeVersion} at ${sourceSha}.`);
