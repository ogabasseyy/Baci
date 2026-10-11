// Serialized inventory appender for the merchant image pilot: the lock
// primitives live in inventory-store.mjs; this module runs record reads,
// validation, and publication through them.
import { open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MAX_INVENTORY_BYTES } from './constants.mjs';
import { readUpToBytes } from './disk-guards.mjs';
import {
  acquireInventoryLock,
  assertInventoryLockHeld,
  PilotAcquireError,
  releaseInventoryLock,
} from './inventory-store.mjs';
import {
  validateInventory,
  validateInventoryUniqueness,
} from './job-schema.mjs';

// Run fn while holding the inventory lock. Shared by the appender and
// the acquisition rollback guard so rollback (check + unlink) and
// publication (verify + append) serialize: without one lock around both
// halves, a rollback can unlink a snapshot after a paused acquirer
// verified it but before it appends — publishing a record that points
// at a missing source.
export async function withInventoryLock(lockDir, fn, hooks = {}) {
  const token = await acquireInventoryLock(lockDir, hooks);
  try {
    const result = await fn();
    // A section whose lock was renamed away mid-section ran
    // concurrently with another holder: surface that loudly before
    // releasing, while the section's outcome is still actionable.
    await assertInventoryLockHeld(lockDir, token);
    return result;
  } finally {
    await releaseInventoryLock(lockDir, token);
  }
}

// Bounded inventory read shared by the serialized appender and the
// acquisition rollback guard: a corrupt or swapped-in giant file
// rejects on size before parsing, never exhausts the caller.
export async function readInventoryRecords(inventoryPath) {
  const { bytes, truncated } = await readUpToBytes(
    inventoryPath,
    MAX_INVENTORY_BYTES
  );
  if (truncated) {
    throw new PilotAcquireError(
      `acquire: inventory exceeds ${MAX_INVENTORY_BYTES} bytes`
    );
  }
  let records;
  try {
    records = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new PilotAcquireError(`acquire: inventory is not valid JSON`);
  }
  if (!Array.isArray(records)) {
    throw new PilotAcquireError(`acquire: inventory is not an array`);
  }
  return records;
}

export function appendInventoryRecord(inventoryPath, record, options = {}) {
  // Serialized: two concurrent appends must never read the same array and
  // overwrite each other, silently dropping an asset.
  const lockDir = `${inventoryPath}.lock`;
  return withInventoryLock(lockDir, async () => {
    let records;
    try {
      records = await readInventoryRecords(inventoryPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        records = [];
      } else {
        throw error;
      }
    }
    // Still under the lock: the caller revalidates whatever its record
    // depends on (the acquisition snapshot must exist) before the
    // publish commits — a rollback that won the lock first unlinked it,
    // so publish fails loudly instead of dangling.
    await options.beforeAppend?.(records);
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
  });
}
