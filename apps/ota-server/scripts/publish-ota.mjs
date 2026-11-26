import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_TYPES = {
  css: 'text/css',
  db: 'application/octet-stream',
  gif: 'image/gif',
  hbc: 'application/javascript',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  json: 'application/json',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  otf: 'font/otf',
  pdf: 'application/pdf',
  png: 'image/png',
  ttf: 'font/ttf',
  wav: 'audio/wav',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

const VALUE_FLAGS = {
  '--dist': 'distDir',
  '--config': 'configPath',
  '--platform': 'platform',
  '--runtime': 'runtimeVersion',
  '--channel': 'channel',
  '--source-sha': 'sourceSha',
  '--update-id': 'updateId',
  '--idempotency-key': 'idempotencyKey',
  '--server': 'serverUrl',
  '--token': 'token',
};

const BOOLEAN_FLAGS = new Set(['--rollback', '--to-embedded', '--dry-run']);
const CHANNEL_REGEX = /^[a-zA-Z0-9._-]{1,64}$/;
const RUNTIME_REGEX = /^[a-zA-Z0-9._+-]{1,128}$/;
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9._:-]{8,128}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/i;

export function inferAssetContentType(ext) {
  const normalized = (ext ?? '').replace(/^\./, '').toLowerCase();
  return CONTENT_TYPES[normalized] ?? 'application/octet-stream';
}

export function parseCliArgs(argv) {
  const options = {
    channel: 'production',
    dryRun: false,
    rollback: false,
    toEmbedded: false,
    serverUrl: process.env.OTA_SERVER_URL || 'https://ota.usebaci.com',
    token: process.env.OTA_ADMIN_TOKEN || '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg in VALUE_FLAGS) {
      const value = argv[i + 1];
      if (
        value === undefined ||
        value.trim().length === 0 ||
        value in VALUE_FLAGS ||
        BOOLEAN_FLAGS.has(value)
      ) {
        throw new Error(`Missing or invalid value for ${arg}`);
      }
      options[VALUE_FLAGS[arg]] = value;
      i += 1;
    } else if (arg === '--rollback') {
      options.rollback = true;
    } else if (arg === '--to-embedded') {
      options.toEmbedded = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (options.platform !== 'ios' && options.platform !== 'android') {
    throw new Error('--platform must be "ios" or "android"');
  }
  if (
    !options.runtimeVersion?.trim() ||
    options.runtimeVersion.includes('..') ||
    !RUNTIME_REGEX.test(options.runtimeVersion.trim())
  ) {
    throw new Error('--runtime is required and must be a valid runtime version');
  }
  if (
    !options.channel?.trim() ||
    options.channel.includes('..') ||
    !CHANNEL_REGEX.test(options.channel.trim())
  ) {
    throw new Error('--channel must be a valid channel name');
  }
  if (options.updateId !== undefined && !UUID_REGEX.test(options.updateId.trim())) {
    throw new Error('--update-id must be a valid UUID');
  }
  if (
    options.idempotencyKey !== undefined &&
    !IDEMPOTENCY_KEY_REGEX.test(options.idempotencyKey.trim())
  ) {
    throw new Error('--idempotency-key must match [a-zA-Z0-9._:-]{8,128}');
  }
  if (
    options.sourceSha !== undefined &&
    !COMMIT_SHA_REGEX.test(options.sourceSha.trim())
  ) {
    throw new Error('--source-sha must be a 40-char hex SHA');
  }
  if (options.toEmbedded && !options.rollback) {
    throw new Error('--to-embedded requires --rollback');
  }
  if (options.rollback && options.toEmbedded && options.updateId) {
    throw new Error('Specify either --update-id or --to-embedded, not both');
  }
  if (
    options.rollback &&
    !options.toEmbedded &&
    !options.updateId &&
    !options.idempotencyKey?.trim()
  ) {
    throw new Error(
      '--idempotency-key is required for targetless --rollback (without --update-id or --to-embedded)'
    );
  }
  if (!options.rollback && !options.distDir?.trim()) {
    throw new Error('--dist is required when publishing');
  }
  if (!options.dryRun && !options.token?.trim()) {
    throw new Error('OTA_ADMIN_TOKEN or --token is required');
  }
  return options;
}

async function readContainedFile(baseDir, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
    throw new Error(`Invalid relative export path: ${String(relativePath)}`);
  }
  const canonicalRoot = await realpath(baseDir);
  const resolved = path.resolve(canonicalRoot, relativePath);
  if (!resolved.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`Export path escapes dist directory: ${relativePath}`);
  }
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Export file must be a regular file: ${relativePath}`);
  }
  const canonicalTarget = await realpath(resolved);
  if (!canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error(`Export path escapes canonical dist root: ${relativePath}`);
  }
  const handle = await open(
    canonicalTarget,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  );
  try {
    const fdStat = await handle.stat();
    if (!fdStat.isFile()) {
      throw new Error(`Export file must be a regular file: ${relativePath}`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

function hashBytes(bytes) {
  const digest = createHash('sha256').update(bytes).digest();
  return {
    sha256Hex: digest.toString('hex'),
    sha256Base64Url: digest.toString('base64url'),
  };
}

const EXPO_CLIENT_ALLOWLIST = {
  name: true,
  slug: true,
  version: true,
  runtimeVersion: true,
  sdkVersion: true,
  platforms: true,
  owner: true,
  scheme: true,
  orientation: true,
  userInterfaceStyle: true,
  updates: {
    enabled: true,
    checkAutomatically: true,
    fallbackToCacheTimeout: true,
    url: true,
    requestHeaders: {
      'expo-channel-name': true,
    },
    codeSigningCertificate: true,
    codeSigningMetadata: {
      alg: true,
      keyid: true,
    },
  },
  ios: {
    bundleIdentifier: true,
    buildNumber: true,
    runtimeVersion: true,
    supportsTablet: true,
    usesAppleSignIn: true,
  },
  android: {
    package: true,
    versionCode: true,
    runtimeVersion: true,
  },
  extra: {
    merchantId: true,
    merchantSlug: true,
    merchantDomain: true,
    businessType: true,
    templateId: true,
    supabaseUrl: true,
    supabasePublishableKey: true,
    supabaseAnonKey: true,
    apiUrl: true,
    posthogApiKey: true,
    posthogHost: true,
    tiktokBusiness: {
      iosAppStoreId: true,
      iosTikTokAppId: true,
      isConfigured: true,
    },
    facebookAppId: true,
    eas: {
      projectId: true,
    },
  },
};

function sanitizeAllowedValue(value, schema) {
  if (typeof value === 'string') {
    if (value.includes('-----BEGIN') && value.includes('PRIVATE KEY')) {
      throw new Error(
        'Refusing to embed private key material in expoClient manifest metadata'
      );
    }
    return value;
  }
  if (schema === true) {
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeAllowedValue(item, true));
    }
    if (value && typeof value === 'object') {
      return undefined;
    }
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const out = {};
  for (const [key, childSchema] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) {
      continue;
    }
    const sanitized = sanitizeAllowedValue(value[key], childSchema);
    if (sanitized !== undefined) {
      out[key] = sanitized;
    }
  }
  return out;
}

function sanitizeExpoClientForManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  return sanitizeAllowedValue(raw, EXPO_CLIENT_ALLOWLIST);
}

export async function packageExportDirectory({
  distDir,
  platform,
  runtimeVersion,
  channel = 'production',
  configPath,
  sourceSha,
  updateId,
}) {
  const metadataRaw = await readContainedFile(distDir, 'metadata.json');
  const metadata = JSON.parse(metadataRaw.toString('utf8'));
  const platformMeta = metadata?.fileMetadata?.[platform];
  if (!platformMeta || typeof platformMeta.bundle !== 'string') {
    throw new Error(`metadata.json is missing fileMetadata.${platform}.bundle`);
  }

  let assetMap = {};
  try {
    const assetMapRaw = await readContainedFile(distDir, 'assetmap.json');
    assetMap = JSON.parse(assetMapRaw.toString('utf8'));
  } catch {
    // assetmap.json is optional if --dump-assetmap was omitted
  }

  const expoClient = configPath
    ? sanitizeExpoClientForManifest(JSON.parse(await readFile(configPath, 'utf8')))
    : undefined;

  const uploads = new Map();
  const bundleBytes = await readContainedFile(distDir, platformMeta.bundle);
  const bundleHashes = hashBytes(bundleBytes);
  const bundleExt = path.extname(platformMeta.bundle) || '.hbc';
  const bundleR2Key = `bundles/${platform}/${bundleHashes.sha256Hex}${bundleExt}`;

  uploads.set(bundleR2Key, {
    r2Key: bundleR2Key,
    bytes: bundleBytes,
    contentType: 'application/javascript',
    sha256Hex: bundleHashes.sha256Hex,
  });

  const assets = [];
  for (const item of platformMeta.assets ?? []) {
    const assetBytes = await readContainedFile(distDir, item.path);
    const assetHashes = hashBytes(assetBytes);
    const ext = item.ext ? (item.ext.startsWith('.') ? item.ext : `.${item.ext}`) : '';
    const rawBasename = path.posix.basename(item.path.replaceAll('\\', '/'));
    const stem =
      ext && rawBasename.endsWith(ext)
        ? rawBasename.slice(0, -ext.length)
        : rawBasename;
    const mapped = assetMap[rawBasename] ?? assetMap[stem];
    const assetKey = typeof mapped?.hash === 'string' ? mapped.hash : stem;
    const contentType = inferAssetContentType(ext);
    const r2Key = `blobs/${assetHashes.sha256Hex}${ext}`;

    if (!uploads.has(r2Key)) {
      uploads.set(r2Key, {
        r2Key,
        bytes: assetBytes,
        contentType,
        sha256Hex: assetHashes.sha256Hex,
      });
    }

    assets.push({
      hash: assetHashes.sha256Base64Url,
      key: assetKey,
      contentType,
      ...(ext ? { fileExtension: ext } : {}),
      r2Key,
    });
  }

  return {
    payload: {
      channel,
      platform,
      runtimeVersion,
      updateId: updateId ?? randomUUID().toLowerCase(),
      ...(updateId ? {} : { createdAt: new Date().toISOString() }),
      ...(sourceSha ? { sourceSha } : {}),
      launchAsset: {
        hash: bundleHashes.sha256Base64Url,
        key: bundleHashes.sha256Hex,
        contentType: 'application/javascript',
        r2Key: bundleR2Key,
      },
      assets,
      metadata: {},
      extra: expoClient ? { expoClient } : {},
    },
    uploads: [...uploads.values()],
  };
}

async function assertOkResponse(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

function normalizeServerBaseUrl(serverUrl) {
  let parsed;
  try {
    parsed = new URL(serverUrl.trim());
  } catch {
    throw new Error(`Invalid OTA server URL: ${serverUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('OTA server URL must use https://');
  }
  const normalizedPath = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\/api\/manifest$/, '');
  if (normalizedPath !== '') {
    throw new Error(
      `OTA server URL must target the root origin without a path prefix: ${serverUrl}`
    );
  }
  return parsed.origin;
}

export async function publishOta(options, fetchImpl = fetch) {
  const packaged = await packageExportDirectory(options);
  if (options.dryRun) {
    return {
      dryRun: true,
      updateId: packaged.payload.updateId,
      uploadCount: packaged.uploads.length,
      payload: packaged.payload,
    };
  }

  const baseUrl = normalizeServerBaseUrl(options.serverUrl);
  const authHeaders = { authorization: `Bearer ${options.token}` };

  for (const asset of packaged.uploads) {
    const headResp = await fetchImpl(`${baseUrl}/api/assets/${asset.r2Key}`, {
      method: 'HEAD',
      redirect: 'error',
    });
    const remoteSha256 = headResp.headers.get('x-asset-sha256')?.trim();
    const remoteContentType = headResp.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase();
    const expectedContentType = asset.contentType
      .split(';')[0]
      ?.trim()
      .toLowerCase();
    if (
      headResp.ok &&
      remoteSha256 &&
      remoteSha256.toLowerCase() === asset.sha256Hex.toLowerCase() &&
      remoteContentType === expectedContentType
    ) {
      continue;
    }
    const MAX_PUT_ATTEMPTS = 4;
    let putResp;
    for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt += 1) {
      putResp = await fetchImpl(`${baseUrl}/api/admin/assets/${asset.r2Key}`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'content-type': asset.contentType,
          'x-asset-sha256': asset.sha256Hex,
        },
        body: asset.bytes,
        redirect: 'error',
      });
      if (putResp.status !== 503 || attempt === MAX_PUT_ATTEMPTS) {
        break;
      }
      await putResp.text();
      const rawRetryAfter = Number(putResp.headers.get('retry-after'));
      const retryDelayMs =
        Number.isFinite(rawRetryAfter) && rawRetryAfter > 0
          ? Math.min(2000, rawRetryAfter * 1000)
          : Math.min(2000, 50 * attempt);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    await assertOkResponse(putResp, `Upload asset ${asset.r2Key}`);
  }

  const publishResp = await fetchImpl(`${baseUrl}/api/admin/publish`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(packaged.payload),
    redirect: 'error',
  });
  if (publishResp.status === 409 && !options.updateId) {
    const conflictBodyText = await publishResp.text();
    let conflictCode;
    try {
      const parsed = JSON.parse(conflictBodyText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        conflictCode = parsed.code;
      }
    } catch {
      conflictCode = undefined;
    }
    if (conflictCode !== 'STALE_TIMESTAMP_CONFLICT') {
      throw new Error(
        `Publish OTA manifest failed (${publishResp.status}): ${conflictBodyText}`
      );
    }
    const { createdAt: _staleCreatedAt, ...retryPayload } = packaged.payload;
    const retryResp = await fetchImpl(`${baseUrl}/api/admin/publish`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...retryPayload,
        updateId: randomUUID().toLowerCase(),
      }),
      redirect: 'error',
    });
    return assertOkResponse(retryResp, 'Publish OTA manifest');
  }
  return assertOkResponse(publishResp, 'Publish OTA manifest');
}

export async function rollbackOta(options, fetchImpl = fetch) {
  const idempotencyKey = options.idempotencyKey?.trim();
  if (!options.toEmbedded && !options.updateId && !idempotencyKey) {
    throw new Error(
      'idempotencyKey is required for targetless rollback (without updateId or toEmbedded)'
    );
  }
  const body = {
    channel: options.channel,
    platform: options.platform,
    runtimeVersion: options.runtimeVersion,
    ...(options.toEmbedded ? { toEmbedded: true } : {}),
    ...(options.updateId ? { targetUpdateId: options.updateId } : {}),
  };
  if (options.dryRun) {
    return { dryRun: true, payload: body };
  }
  const baseUrl = normalizeServerBaseUrl(options.serverUrl);
  const resp = await fetchImpl(`${baseUrl}/api/admin/rollback`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token}`,
      'content-type': 'application/json',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    redirect: 'error',
  });
  return assertOkResponse(resp, 'Rollback OTA release');
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const options = parseCliArgs(process.argv.slice(2));
  Promise.resolve(options.rollback ? rollbackOta(options) : publishOta(options))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
