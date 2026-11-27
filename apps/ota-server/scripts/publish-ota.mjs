import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeServerBaseUrl, parseCliArgs } from './publish-ota-args.mjs';
import {
  hashBytes,
  inferAssetContentType,
  readContainedFile,
  sanitizeExpoClientForManifest,
} from './publish-ota-sanitize.mjs';

export { inferAssetContentType, parseCliArgs };

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
  const seenAssetKeys = new Set();
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
    const baseAssetKey = typeof mapped?.hash === 'string' ? mapped.hash : stem;
    let assetKey = baseAssetKey;
    if (seenAssetKeys.has(assetKey)) {
      assetKey = `${baseAssetKey}-${assetHashes.sha256Hex.slice(0, 12)}`;
      if (seenAssetKeys.has(assetKey)) {
        let suffix = 2;
        while (seenAssetKeys.has(`${assetKey}-${suffix}`)) {
          suffix += 1;
        }
        assetKey = `${assetKey}-${suffix}`;
      }
    }
    seenAssetKeys.add(assetKey);
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
    ...(options.expectedCurrentUpdateId?.trim()
      ? { expectedCurrentUpdateId: options.expectedCurrentUpdateId.trim() }
      : {}),
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
