import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { STOREFRONT_OTA_CONFIG } from './storefront-ota-constants.mjs';
import { collectExportDigests } from './storefront-ota-digest-collection.mjs';
import { assertNoPrivateValues } from './storefront-ota-secret-scan.mjs';
import { sha256 } from './storefront-ota-sha256.mjs';

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateSelfHostedOtaConfig(config, { platform, runtimeVersion, channel, expectedUpdatesUrl }) {
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`Invalid platform for OTA verification: ${String(platform)}`);
  }
  const actualRuntime = platform === 'ios'
    ? (config.ios?.runtimeVersion ?? config.runtimeVersion)
    : (config.android?.runtimeVersion ?? config.runtimeVersion);
  if (actualRuntime !== runtimeVersion) {
    throw new Error(`Export ${platform} runtime (${actualRuntime}) does not match selected runtime (${runtimeVersion}).`);
  }
  if (platform === 'ios') {
    const buildMatch = /^(\d+\.\d+\.(\d+))(?:-[a-zA-Z0-9._+-]+)?$/.exec(runtimeVersion);
    if (!buildMatch || config.ios?.buildNumber !== buildMatch[2]) {
      throw new Error('Export iOS build number does not match the runtime.');
    }
    if (config.ios?.bundleIdentifier !== STOREFRONT_OTA_CONFIG.bundleIdentifier) {
      throw new Error('Export iOS bundleIdentifier is incorrect.');
    }
  } else if (config.android?.package !== 'com.ogabassey.store') {
    throw new Error('Export Android package is incorrect.');
  }

  if (
    config.extra?.eas?.projectId !== STOREFRONT_OTA_CONFIG.projectId ||
    config.updates?.url !== expectedUpdatesUrl ||
    config.updates?.requestHeaders?.['expo-channel-name'] !== channel
  ) {
    throw new Error('Export app updates URL, Expo project, or update channel is incorrect.');
  }
  if (
    config.extra?.merchantId !== STOREFRONT_OTA_CONFIG.merchantId ||
    config.extra?.merchantSlug !== STOREFRONT_OTA_CONFIG.merchantSlug ||
    config.extra?.merchantDomain !== STOREFRONT_OTA_CONFIG.merchantDomain
  ) {
    throw new Error('Export merchant configuration is incorrect.');
  }
  if (
    !present(config.extra?.supabaseUrl) ||
    !(present(config.extra?.supabaseAnonKey) || present(config.extra?.supabasePublishableKey))
  ) {
    throw new Error('Export is missing public Supabase configuration.');
  }
  if (
    config.extra?.apiUrl !== STOREFRONT_OTA_CONFIG.apiUrl ||
    !present(config.extra?.posthogApiKey) ||
    !present(config.extra?.facebookAppId) ||
    !present(config.extra?.facebookClientToken)
  ) {
    throw new Error('Export is missing required production app configuration.');
  }
}

async function readContainedExportFile(directory, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error('Export metadata has an invalid file path.');
  }
  const canonicalRoot = await realpath(directory);
  const resolved = path.resolve(canonicalRoot, relativePath);
  if (!resolved.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error('Export metadata references a file outside the export.');
  }
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Export metadata references a non-regular file.');
  }
  const canonicalTarget = await realpath(resolved);
  if (!canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error('Export metadata symlink escapes export root.');
  }
  const handle = await open(canonicalTarget, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function validateSelfHostedExportMetadata(directory, platform, sourceSha) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error('Source revision must be a full Git commit SHA.');
  }
  const metadata = JSON.parse((await readContainedExportFile(directory, 'metadata.json')).toString('utf8'));
  const platformMeta = metadata.fileMetadata?.[platform];
  if (!platformMeta || Object.keys(metadata.fileMetadata).length !== 1 || !Array.isArray(platformMeta.assets)) {
    throw new Error(`Export must contain a ${platform} bundle and no other platform.`);
  }
  const bundle = await readContainedExportFile(directory, platformMeta.bundle);
  if (!bundle.includes(sourceSha)) {
    throw new Error('Bundle revision does not match the selected source revision.');
  }
  try {
    await readContainedExportFile(directory, `${platformMeta.bundle}.map`);
  } catch {
    throw new Error('Export is missing a readable bundle source map.');
  }
  for (const asset of platformMeta.assets) {
    await readContainedExportFile(directory, asset.path);
  }
}

export async function verifySelfHostedOtaExport({
  directory,
  platform,
  runtimeVersion,
  channel,
  sourceSha,
  expectedUpdatesUrl,
  secrets,
}) {
  const config = JSON.parse(await readFile(path.join(directory, 'expo-config.json'), 'utf8'));
  validateSelfHostedOtaConfig(config, { platform, runtimeVersion, channel, expectedUpdatesUrl });
  await validateSelfHostedExportMetadata(path.join(directory, 'dist'), platform, sourceSha);
  await assertNoPrivateValues(directory, secrets);
  const recorded = {
    platform,
    runtimeVersion,
    channel,
    sourceSha,
    updatesUrl: expectedUpdatesUrl,
    files: await collectExportDigests(directory),
  };
  const contents = `${JSON.stringify(recorded, null, 2)}\n`;
  await writeFile(path.join(directory, 'provenance.json'), contents);
  return { provenanceSha256: sha256(contents), fileCount: Object.keys(recorded.files).length };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const [directory, platform, runtimeVersion, channel, sourceSha, expectedUpdatesUrl, ...extra] = process.argv.slice(2);
  if (!directory || !platform || !runtimeVersion || !channel || !sourceSha || !expectedUpdatesUrl || extra.length > 0) {
    throw new Error(
      'Usage: verify-storefront-self-hosted-ota-export <directory> <platform> <runtime> <channel> <sourceSha> <expectedUpdatesUrl>'
    );
  }
  const result = await verifySelfHostedOtaExport({
    directory,
    platform,
    runtimeVersion,
    channel,
    sourceSha,
    expectedUpdatesUrl,
    secrets: {
      SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
      STOREFRONT_TIKTOK_APP_SECRET: process.env.STOREFRONT_TIKTOK_APP_SECRET,
      OTA_ADMIN_TOKEN: process.env.OTA_ADMIN_TOKEN,
    },
  });
  console.log(`Verified ${platform} OTA export (${result.fileCount} files, provenance ${result.provenanceSha256}) for ${runtimeVersion}.`);
}
