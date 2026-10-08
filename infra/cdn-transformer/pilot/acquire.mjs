import { createHash } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseCliArgs } from './cli-args.mjs';
import {
  MAX_INPUT_BYTES,
  OP_TIMEOUT_MS,
  PILOT_UUID_PATTERN,
  ROLES,
} from './constants.mjs';
import { readUpToBytes } from './disk-guards.mjs';
import { assertPublicFetchUrl } from './fetch-policy.mjs';
import {
  ASSET_ID_PATTERN,
  resolveNewSnapshotPath,
  snapshotNameForAsset,
} from './input-store.mjs';
import {
  appendInventoryRecord,
  PilotAcquireError,
} from './inventory-store.mjs';
import { parsePilotJob } from './job-schema.mjs';

export const EXTENSION_FOR_CONTENT_TYPE = {
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const AcquireIdentitySchema = z
  .object({
    // Same contract the shared job schema and snapshot namer enforce, so a
    // bad id fails here instead of after the whole remote image downloads.
    assetId: z.string().regex(ASSET_ID_PATTERN),
    merchantId: z.string().regex(PILOT_UUID_PATTERN),
    role: z.enum(ROLES),
    slot: z.string().min(1).max(128),
  })
  .strict();

// Decoded-format to MIME map for the acquisition content-type cross-check.
// Sharp reports 'jpeg' (never 'jpg'); anything unmapped fails closed.
const CONTENT_TYPE_FOR_DECODED_FORMAT = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

async function defaultProbe() {
  const { probeImageFile } = await import('./encoder.mjs');
  return probeImageFile;
}

async function fetchBoundedBytes(
  url,
  { allowPrivateHosts, maxBytes, timeoutMs }
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new PilotAcquireError(`acquire: invalid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PilotAcquireError(`acquire: only http(s) URLs are allowed`);
  }
  // Loopback fixtures (node:http test servers) opt in explicitly; the
  // operator CLI never does, so a mistyped inventory URL fails closed.
  if (!allowPrivateHosts) {
    assertPublicFetchUrl(url);
  }
  let response;
  try {
    response = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new PilotAcquireError(
      `acquire: fetch failed or timed out after ${timeoutMs}ms (${error?.name ?? 'fetch'})`
    );
  }
  if (!response.ok) {
    throw new PilotAcquireError(
      `acquire: origin returned HTTP ${response.status}`
    );
  }
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (!Object.hasOwn(EXTENSION_FOR_CONTENT_TYPE, contentType)) {
    await response.body?.cancel?.().catch(() => undefined);
    throw new PilotAcquireError(
      `acquire: unsupported content-type "${contentType}"`
    );
  }
  if (!response.body) {
    throw new PilotAcquireError('acquire: origin returned an empty body');
  }
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PilotAcquireError(
          `acquire: body exceeds ${maxBytes} byte limit`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks), contentType };
}

export async function acquireSnapshot(options) {
  const {
    allowPrivateHosts = false,
    assetId,
    inputRoot,
    inventoryPath,
    maxBytes = MAX_INPUT_BYTES,
    merchantId,
    probe,
    role,
    slot,
    timeoutMs = OP_TIMEOUT_MS,
    url,
  } = options ?? {};
  const identity = AcquireIdentitySchema.safeParse({
    assetId,
    merchantId,
    role,
    slot,
  });
  if (!identity.success) {
    const fields = identity.error.issues.map((issue) => issue.path.join('.'));
    throw new PilotAcquireError(
      `acquire: invalid identity (${fields.join(', ')})`
    );
  }
  // The snapshot stem is "<merchantId>-<assetId>" capped at 128 chars; a
  // 92+ char asset id would otherwise download fully, then fail naming.
  if (`${merchantId}-${assetId}`.length > 128) {
    throw new PilotAcquireError(
      `acquire: asset id keeps the snapshot stem over 128 characters`
    );
  }
  const { bytes, contentType } = await fetchBoundedBytes(url, {
    allowPrivateHosts,
    maxBytes,
    timeoutMs,
  });
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fileName = snapshotNameForAsset(
    merchantId,
    assetId,
    EXTENSION_FOR_CONTENT_TYPE[contentType]
  );
  const target = await resolveNewSnapshotPath(inputRoot, fileName);
  // Bounded like the download: a corrupt or swapped-in giant stale
  // snapshot must reject on size before the equality comparison, never
  // load fully into the acquisition process.
  const prior = await readUpToBytes(target, maxBytes).catch((error) => {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (prior?.truncated) {
    throw new PilotAcquireError(
      `acquire: stored snapshot for "${assetId}" exceeds ${maxBytes} bytes`
    );
  }
  const existing = prior?.bytes ?? null;
  if (existing && !existing.equals(bytes)) {
    throw new PilotAcquireError(
      `acquire: stored snapshot for "${assetId}" differs from fetched bytes`
    );
  }
  let wroteSnapshot = false;
  if (!existing) {
    await writeFile(target, bytes, { flag: 'wx' });
    wroteSnapshot = true;
  }
  const probeFile = probe ?? (await defaultProbe());
  let geometry;
  try {
    geometry = await probeFile(target);
  } catch (error) {
    // A rejected probe leaves no orphan behind: remove only the file this
    // call wrote, never a pre-existing snapshot, then rethrow the original
    // probe error (cleanup best-effort).
    if (wroteSnapshot) {
      await unlink(target).catch(() => undefined);
    }
    throw error;
  }
  // The origin's label must agree with the decoded bytes: JPEG bytes filed
  // as image/png would stage a mismatched snapshot and control URL.
  const decodedContentType = CONTENT_TYPE_FOR_DECODED_FORMAT[geometry?.format];
  if (decodedContentType !== contentType) {
    if (wroteSnapshot) {
      await unlink(target).catch(() => undefined);
    }
    throw new PilotAcquireError(
      `acquire: origin labeled bytes "${contentType}" but they decode as "${geometry?.format ?? 'unknown'}"`
    );
  }
  // Acquisition dims are display-oriented: an EXIF orientation of 5-8
  // transposes the stored axes, so the record files the dimensions a
  // browser renders, not the raw probe axes. Probes that already report
  // oriented dims win; otherwise the orientation flag swaps raw axes.
  const orientation = geometry.orientation ?? 1;
  const swapAxes = orientation >= 5 && orientation <= 8;
  const record = {
    assetId,
    capturedAt: new Date().toISOString(),
    contentType,
    height:
      geometry.orientedHeight ?? (swapAxes ? geometry.width : geometry.height),
    merchantId,
    orientation: geometry.orientation ?? null,
    role,
    schemaVersion: 1,
    sha256,
    size: bytes.length,
    slot,
    sourcePath: fileName,
    url,
    width:
      geometry.orientedWidth ?? (swapAxes ? geometry.height : geometry.width),
  };
  const job = parsePilotJob({
    assetId,
    expectedSha256: sha256,
    merchantId,
    role,
    schemaVersion: 1,
    sourcePath: fileName,
  });
  if (!job.ok) {
    throw new PilotAcquireError(
      `acquire: built invalid job (${job.issues.join('; ')})`
    );
  }
  if (inventoryPath === undefined) {
    return record;
  }
  // Append-and-roll-back: the snapshot above is already committed, but a
  // rejected append (capacity, merchant/slot collision) must not leave an
  // orphan no record references — a later retry after the remote image
  // changes would then be rejected by the stale bytes. Only this call's
  // own file is removed, never a pre-existing snapshot.
  try {
    const inventoryCount = await appendInventoryRecord(inventoryPath, record);
    return { ...record, inventoryCount };
  } catch (error) {
    if (wroteSnapshot) {
      await unlink(target).catch(() => undefined);
    }
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = parseCliArgs(process.argv.slice(2), [
      'url',
      'merchant',
      'asset',
      'role',
      'slot',
      'input-root',
      'inventory',
    ]);
    const record = await acquireSnapshot({
      assetId: args.asset,
      inputRoot: args['input-root'],
      inventoryPath: args.inventory,
      merchantId: args.merchant,
      role: args.role,
      slot: args.slot,
      url: args.url,
    });
    console.log(
      JSON.stringify({
        count: record.inventoryCount,
        sha256: record.sha256,
        sourcePath: record.sourcePath,
      })
    );
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
