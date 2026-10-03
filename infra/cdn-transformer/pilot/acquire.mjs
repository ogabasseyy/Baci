import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseCliArgs } from './cli-args.mjs';
import { MAX_INPUT_BYTES, OP_TIMEOUT_MS, ROLES } from './constants.mjs';
import { assertPublicFetchUrl } from './fetch-policy.mjs';
import {
  ASSET_ID_PATTERN,
  resolveNewSnapshotPath,
  snapshotNameForAsset,
} from './input-store.mjs';
import {
  parsePilotJob,
  validateInventory,
  validateInventoryUniqueness,
} from './job-schema.mjs';

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
    merchantId: z.string().uuid(),
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

export class PilotAcquireError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotAcquireError';
  }
}

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
    await response.body?.cancel?.().catch(() => {});
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
        await reader.cancel().catch(() => {});
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
  const existing = await readFile(target).catch((error) => {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
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
      await unlink(target).catch(() => {});
    }
    throw error;
  }
  // The origin's label must agree with the decoded bytes: JPEG bytes filed
  // as image/png would stage a mismatched snapshot and control URL.
  const decodedContentType = CONTENT_TYPE_FOR_DECODED_FORMAT[geometry?.format];
  if (decodedContentType !== contentType) {
    if (wroteSnapshot) {
      await unlink(target).catch(() => {});
    }
    throw new PilotAcquireError(
      `acquire: origin labeled bytes "${contentType}" but they decode as "${geometry?.format ?? 'unknown'}"`
    );
  }
  const record = {
    assetId,
    capturedAt: new Date().toISOString(),
    contentType,
    height: geometry.height,
    merchantId,
    role,
    schemaVersion: 1,
    sha256,
    size: bytes.length,
    slot,
    sourcePath: fileName,
    url,
    width: geometry.width,
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
  return record;
}

const INVENTORY_LOCK_TIMEOUT_MS = 10_000;
const INVENTORY_LOCK_STALE_MS = 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isStaleInventoryLock(lockDir) {
  const owner = await readFile(join(lockDir, 'owner.json'), 'utf8').catch(
    () => null
  );
  // No owner file yet: a holder is mid-acquire, not stale.
  if (owner === null) {
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(owner);
  } catch {
    return true;
  }
  if (Date.now() - Date.parse(parsed.startedAt) > INVENTORY_LOCK_STALE_MS) {
    return true;
  }
  if (Number.isInteger(parsed.pid)) {
    try {
      process.kill(parsed.pid, 0);
    } catch {
      return true;
    }
  }
  return false;
}

async function acquireInventoryLock(lockDir) {
  const deadline = Date.now() + INVENTORY_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockDir);
      await writeFile(
        join(lockDir, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        })
      );
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }
    // Steal a crashed holder's lock instead of wedging every future append.
    if (await isStaleInventoryLock(lockDir)) {
      await rm(lockDir, { force: true, recursive: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new PilotAcquireError(
        `acquire: timed out waiting for the inventory lock`
      );
    }
    await sleep(25);
  }
}

async function releaseInventoryLock(lockDir) {
  await rm(lockDir, { force: true, recursive: true });
}

export async function appendInventoryRecord(inventoryPath, record) {
  // Serialized: two concurrent appends must never read the same array and
  // overwrite each other, silently dropping an asset.
  const lockDir = `${inventoryPath}.lock`;
  await acquireInventoryLock(lockDir);
  try {
    const existing = await readFile(inventoryPath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') {
        return '[]';
      }
      throw error;
    });
    let records;
    try {
      records = JSON.parse(existing);
    } catch {
      throw new PilotAcquireError(`acquire: inventory is not valid JSON`);
    }
    if (!Array.isArray(records)) {
      throw new PilotAcquireError(`acquire: inventory is not an array`);
    }
    records.push(record);
    const jobs = records.map((entry) => ({
      assetId: entry.assetId,
      expectedSha256: entry.sha256,
      merchantId: entry.merchantId,
      role: entry.role,
      schemaVersion: entry.schemaVersion,
      sourcePath: entry.sourcePath,
    }));
    const validated = validateInventory(jobs);
    if (!validated.ok) {
      throw new PilotAcquireError(
        `acquire: inventory invalid (${validated.errors.join('; ')})`
      );
    }
    const unique = validateInventoryUniqueness(records);
    if (!unique.ok) {
      throw new PilotAcquireError(
        `acquire: inventory invalid (${unique.errors.join('; ')})`
      );
    }
    // Publish via temp + fsync + atomic rename so an interruption leaves the
    // old inventory or the new one, never half-written JSON.
    const tmp = join(
      dirname(inventoryPath),
      `.inventory-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
    );
    const handle = await open(tmp, 'w');
    try {
      await handle.writeFile(`${JSON.stringify(records, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, inventoryPath);
    return records.length;
  } finally {
    await releaseInventoryLock(lockDir);
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
      merchantId: args.merchant,
      role: args.role,
      slot: args.slot,
      url: args.url,
    });
    const count = await appendInventoryRecord(args.inventory, record);
    console.log(
      JSON.stringify({
        count,
        sha256: record.sha256,
        sourcePath: record.sourcePath,
      })
    );
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
