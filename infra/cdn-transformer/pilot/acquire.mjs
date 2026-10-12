import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  EXTENSION_FOR_CONTENT_TYPE,
  fetchBoundedBytes,
} from './acquire-fetch.mjs';
import { parseCliArgs } from './cli-args.mjs';
import { MAX_INPUT_BYTES, OP_TIMEOUT_MS } from './constants.mjs';
import { readUpToBytes } from './disk-guards.mjs';
import {
  resolveNewSnapshotPath,
  snapshotNameForAsset,
  writeNewSnapshot,
} from './input-store.mjs';
import {
  appendInventoryRecord,
  readInventoryRecords,
  withInventoryLock,
} from './inventory-append.mjs';
import {
  PilotAcquireError,
  PilotInventoryEvictedError,
} from './inventory-store.mjs';
import { parseAcquireIdentity, parsePilotJob } from './job-schema.mjs';

export { EXTENSION_FOR_CONTENT_TYPE };

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
  const identity = parseAcquireIdentity({ assetId, merchantId, role, slot });
  if (!identity.ok) {
    throw new PilotAcquireError(
      `acquire: invalid identity (${identity.issues.join(', ')})`
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
    await writeNewSnapshot(target, bytes);
    wroteSnapshot = true;
  }
  // Overlap guard: two acquisitions for the same asset can interleave so
  // that this call wrote the snapshot but lost the inventory-append race
  // — the winner's published record references these exact bytes.
  // Rollback unlinks only when no published record references the target,
  // and the check-plus-unlink runs under the inventory lock: otherwise a
  // paused acquirer could publish between the check and the unlink,
  // leaving a record that points at a missing source. An unreadable
  // inventory keeps the file (orphan bytes a retry reuses or flags as
  // differing, never a record pointing at a missing source).
  async function rollbackOwnSnapshot() {
    if (inventoryPath === undefined) {
      await unlink(target).catch(() => undefined);
      return;
    }
    try {
      await withInventoryLock(`${inventoryPath}.lock`, async () => {
        const records = await readInventoryRecords(inventoryPath).catch(
          () => null
        );
        if (
          records === null ||
          records.some((entry) => entry?.sourcePath === fileName)
        ) {
          return;
        }
        await unlink(target).catch(() => undefined);
      });
    } catch (error) {
      if (error instanceof PilotInventoryEvictedError) {
        // The check-then-unlink may have raced a concurrent publish:
        // the unlinked snapshot may now be referenced. That dangles a
        // record, so it stays loud (masking the append failure it
        // followed) instead of failing silently.
        throw error;
      }
      // A lock timeout under contention keeps the file: orphan bytes a
      // retry reuses or flags as differing — and the original append
      // failure below is the actionable error, not the rollback.
    }
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
      await rollbackOwnSnapshot();
    }
    throw error;
  }
  // The origin's label must agree with the decoded bytes: JPEG bytes filed
  // as image/png would stage a mismatched snapshot and control URL.
  const decodedContentType = CONTENT_TYPE_FOR_DECODED_FORMAT[geometry?.format];
  if (decodedContentType !== contentType) {
    if (wroteSnapshot) {
      await rollbackOwnSnapshot();
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
    // The snapshot must still be THE probed bytes when the append
    // commits: a rival rollback that won the lock first unlinked it, and
    // another process may have replaced it since the probe — so reread
    // through the bounded reader and compare the hash under the same
    // lock. Existence alone would publish the fetched SHA and geometry
    // against a sourcePath that now names different bytes.
    const inventoryCount = await appendInventoryRecord(inventoryPath, record, {
      beforeAppend: async () => {
        const reread = await readUpToBytes(target, maxBytes).catch(() => null);
        const current =
          reread && !reread.truncated
            ? createHash('sha256').update(reread.bytes).digest('hex')
            : null;
        if (current === null) {
          throw new PilotAcquireError(
            `acquire: snapshot for "${assetId}" vanished before publish`
          );
        }
        if (current !== sha256) {
          throw new PilotAcquireError(
            `acquire: snapshot for "${assetId}" changed before publish`
          );
        }
      },
    });
    return { ...record, inventoryCount };
  } catch (error) {
    if (wroteSnapshot) {
      await rollbackOwnSnapshot();
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
