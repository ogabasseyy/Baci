import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ID = 'c6c1897b-cac8-49b0-85f9-3d277aecc379';

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateOtaConfig(config, runtimeVersion) {
  if ((config.ios?.runtimeVersion ?? config.runtimeVersion) !== runtimeVersion) {
    throw new Error('Export runtime does not match the selected iOS runtime.');
  }
  if (config.ios?.buildNumber !== runtimeVersion.split('.').at(-1)) {
    throw new Error('Export iOS build number does not match the runtime.');
  }
  if (
    config.ios?.bundleIdentifier !== 'com.ogabassey.app' ||
    config.extra?.eas?.projectId !== PROJECT_ID ||
    config.updates?.url !== `https://u.expo.dev/${PROJECT_ID}` ||
    config.updates?.requestHeaders?.['expo-channel-name'] !== 'production'
  ) {
    throw new Error('Export app, Expo project, or update channel is incorrect.');
  }
  if (
    config.extra?.merchantId !== '6b5cb8a4-5575-456c-b936-8cdfae30db74' ||
    config.extra?.merchantSlug !== 'ogabassey' ||
    config.extra?.merchantDomain !== 'ogabassey.com'
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
    config.extra?.apiUrl !== 'https://usebaci.com' ||
    !present(config.extra?.posthogApiKey) ||
    !present(config.extra?.facebookAppId) ||
    !present(config.extra?.facebookClientToken)
  ) {
    throw new Error('Export is missing required production app configuration.');
  }
}

export async function assertNoPrivateValues(directory, values) {
  const secrets = Object.entries(values).map(([name, value]) => {
    if (!present(value)) throw new Error(`Missing build-only secret ${name} for scanning.`);
    return [name, Buffer.from(value)];
  });
  for (const [name, value] of secrets) {
    if (value.length < 8) throw new Error(`Cannot scan short secret ${name}.`);
  }

  async function scan(currentDirectory) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Export contains a symbolic link.');
      if (entry.isDirectory()) {
        await scan(entryPath);
      } else if (entry.isFile()) {
        const contents = await readFile(entryPath);
        for (const [name, value] of secrets) {
          if (contents.includes(value)) {
            throw new Error(`Export contains build-only secret ${name}.`);
          }
        }
      }
    }
  }
  await scan(directory);
}

export async function validateExportMetadata(directory, sourceSha) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error('Source revision must be a full Git commit SHA.');
  }
  const metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8'));
  const ios = metadata.fileMetadata?.ios;
  if (!ios || Object.keys(metadata.fileMetadata).length !== 1 || !Array.isArray(ios.assets)) {
    throw new Error('Export must contain an iOS bundle and no other platform.');
  }
  async function readExportFile(relativePath) {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
      throw new Error('Export metadata has an invalid file path.');
    }
    const resolved = path.resolve(directory, relativePath);
    if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) {
      throw new Error('Export metadata references a file outside the export.');
    }
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Export metadata references a non-regular file.');
    }
    return readFile(resolved);
  }
  const bundle = await readExportFile(ios.bundle);
  if (!bundle.includes(sourceSha)) {
    throw new Error('Bundle revision does not match the selected source revision.');
  }
  try {
    await readExportFile(`${ios.bundle}.map`);
  } catch {
    throw new Error('Export is missing a readable bundle source map.');
  }
  for (const asset of ios.assets) {
    await readExportFile(asset.path);
  }
}
