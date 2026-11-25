import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTENT_TYPES = {
  css: 'text/css',
  db: 'application/octet-stream',
  gif: 'image/gif',
  hbc: 'application/javascript',
  html: 'text/html',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  json: 'application/json',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  otf: 'font/otf',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  wav: 'audio/wav',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

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
    const next = argv[i + 1];
    switch (arg) {
      case '--dist':
        options.distDir = next;
        i += 1;
        break;
      case '--config':
        options.configPath = next;
        i += 1;
        break;
      case '--platform':
        options.platform = next;
        i += 1;
        break;
      case '--runtime':
        options.runtimeVersion = next;
        i += 1;
        break;
      case '--channel':
        options.channel = next;
        i += 1;
        break;
      case '--source-sha':
        options.sourceSha = next;
        i += 1;
        break;
      case '--update-id':
        options.updateId = next;
        i += 1;
        break;
      case '--server':
        options.serverUrl = next;
        i += 1;
        break;
      case '--token':
        options.token = next;
        i += 1;
        break;
      case '--rollback':
        options.rollback = true;
        break;
      case '--to-embedded':
        options.toEmbedded = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (options.platform !== 'ios' && options.platform !== 'android') {
    throw new Error('--platform must be "ios" or "android"');
  }
  if (!options.runtimeVersion?.trim()) {
    throw new Error('--runtime is required');
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
  const baseResolved = path.resolve(baseDir);
  const resolved = path.resolve(baseResolved, relativePath);
  if (!resolved.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error(`Export path escapes dist directory: ${relativePath}`);
  }
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Export file must be a regular file: ${relativePath}`);
  }
  return readFile(resolved);
}

function hashBytes(bytes) {
  const digest = createHash('sha256').update(bytes).digest();
  return {
    sha256Hex: digest.toString('hex'),
    sha256Base64Url: digest.toString('base64url'),
  };
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

  let expoClient;
  if (configPath) {
    expoClient = JSON.parse(await readFile(configPath, 'utf8'));
  }

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

  const launchAsset = {
    hash: bundleHashes.sha256Base64Url,
    key: bundleHashes.sha256Hex,
    contentType: 'application/javascript',
    fileExtension: bundleExt,
    r2Key: bundleR2Key,
  };

  const assets = [];
  for (const item of platformMeta.assets ?? []) {
    const assetBytes = await readContainedFile(distDir, item.path);
    const assetHashes = hashBytes(assetBytes);
    const rawBasename = path.posix.basename(item.path.replaceAll('\\', '/'));
    const mapped = assetMap[rawBasename];
    const assetKey = typeof mapped?.hash === 'string' ? mapped.hash : rawBasename;
    const ext = item.ext ? (item.ext.startsWith('.') ? item.ext : `.${item.ext}`) : '';
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

  const payload = {
    channel,
    platform,
    runtimeVersion,
    updateId: updateId ?? randomUUID().toLowerCase(),
    createdAt: new Date().toISOString(),
    ...(sourceSha ? { sourceSha } : {}),
    launchAsset,
    assets,
    metadata: {},
    extra: expoClient ? { expoClient } : {},
  };

  return { payload, uploads: [...uploads.values()] };
}

async function assertOkResponse(response, label) {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} failed (${response.status}): ${text}`);
  }
  return response.json();
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

  const baseUrl = options.serverUrl.replace(/\/+$/, '');
  const authHeaders = { authorization: `Bearer ${options.token}` };

  for (const asset of packaged.uploads) {
    const headResp = await fetchImpl(`${baseUrl}/api/assets/${asset.r2Key}`, {
      method: 'HEAD',
    });
    if (headResp.ok) {
      continue;
    }
    const putResp = await fetchImpl(`${baseUrl}/api/admin/assets/${asset.r2Key}`, {
      method: 'PUT',
      headers: {
        ...authHeaders,
        'content-type': asset.contentType,
        'x-asset-sha256': asset.sha256Hex,
      },
      body: asset.bytes,
    });
    await assertOkResponse(putResp, `Upload asset ${asset.r2Key}`);
  }

  const publishResp = await fetchImpl(`${baseUrl}/api/admin/publish`, {
    method: 'POST',
    headers: {
      ...authHeaders,
      'content-type': 'application/json',
    },
    body: JSON.stringify(packaged.payload),
  });
  return assertOkResponse(publishResp, 'Publish OTA manifest');
}

export async function rollbackOta(options, fetchImpl = fetch) {
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

  const baseUrl = options.serverUrl.replace(/\/+$/, '');
  const resp = await fetchImpl(`${baseUrl}/api/admin/rollback`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return assertOkResponse(resp, 'Rollback OTA release');
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = options.rollback
    ? await rollbackOta(options)
    : await publishOta(options);
  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
