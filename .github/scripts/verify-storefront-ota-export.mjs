import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateOtaConfig } from './storefront-ota-config-validation.mjs';
import { collectExportDigests } from './storefront-ota-digest-collection.mjs';
import { validateExportDigests } from './storefront-ota-digest-validation.mjs';
import { validateExportMetadata } from './storefront-ota-metadata-validation.mjs';
import { assertNoPrivateValues } from './storefront-ota-secret-scan.mjs';
import { sha256 } from './storefront-ota-sha256.mjs';

const [directory, runtimeVersion, sourceSha, mode, trustedDigest, ...extraArgs] = process.argv.slice(2);
if (
  !directory || !runtimeVersion || !sourceSha || extraArgs.length ||
  (mode && (mode !== '--public-only' || !/^[a-f0-9]{64}$/.test(trustedDigest ?? ''))) ||
  (!mode && trustedDigest)
) {
  throw new Error('Usage: verify-storefront-ota-export <directory> <runtime> <commit> [--public-only <trusted-provenance-sha256>]');
}
const config = JSON.parse(await readFile(path.join(directory, 'expo-config.json'), 'utf8'));
validateOtaConfig(config, runtimeVersion);
await validateExportMetadata(path.join(directory, 'dist'), sourceSha);
const provenance = { platform: 'ios', runtimeVersion, sourceSha };
const provenancePath = path.join(directory, 'provenance.json');
if (mode === '--public-only') {
  const contents = await readFile(provenancePath);
  if (sha256(contents) !== trustedDigest) {
    throw new Error('Provenance digest does not match the successful workflow run.');
  }
  const recorded = JSON.parse(contents);
  if (Object.keys(provenance).some((key) => recorded[key] !== provenance[key])) {
    throw new Error('Export provenance does not match the selected update.');
  }
  validateExportDigests(await collectExportDigests(directory), recorded.files);
  console.log('Private values were not scanned locally; rely on the verified workflow run.');
} else {
  await assertNoPrivateValues(directory, {
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    STOREFRONT_TIKTOK_APP_SECRET: process.env.STOREFRONT_TIKTOK_APP_SECRET,
  });
  const recorded = { ...provenance, files: await collectExportDigests(directory) };
  const contents = `${JSON.stringify(recorded, null, 2)}\n`;
  await writeFile(provenancePath, contents);
  console.log(`Provenance SHA-256: ${sha256(contents)}`);
}
console.log(`Verified iOS OTA export for runtime ${runtimeVersion} at ${sourceSha}.`);
