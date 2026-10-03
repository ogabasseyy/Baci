import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseCliArgs } from './cli-args.mjs';
import { MAX_INPUT_BYTES, OP_TIMEOUT_MS, ROLES } from './constants.mjs';
import {
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
    assetId: z.string().min(1),
    merchantId: z.string().uuid(),
    role: z.enum(ROLES),
    slot: z.string().min(1).max(128),
  })
  .strict();

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

async function fetchBoundedBytes(url, { maxBytes, timeoutMs }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new PilotAcquireError(`acquire: invalid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PilotAcquireError(`acquire: only http(s) URLs are allowed`);
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
    throw new PilotAcquireError(`acquire: origin returned HTTP ${response.status}`);
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
  const { bytes, contentType } = await fetchBoundedBytes(url, {
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
    throw new PilotAcquireError(`acquire: built invalid job (${job.issues.join('; ')})`);
  }
  return record;
}

export async function appendInventoryRecord(inventoryPath, record) {
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
  await writeFile(inventoryPath, `${JSON.stringify(records, null, 2)}\n`);
  return records.length;
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
      JSON.stringify({ count, sha256: record.sha256, sourcePath: record.sourcePath })
    );
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
