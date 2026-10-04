// Serialized inventory writer for the merchant image pilot: two
// concurrent appends must never read the same array and overwrite each
// other, silently dropping an asset.
//
// Locking is a mkdir-exclusive directory with an owner file. Stale locks
// (crashed holders) are stolen after bounded timeouts, and release is
// ownership-checked: a slow append whose lock was stolen must not delete
// the replacement and admit a third appender alongside it.
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  validateInventory,
  validateInventoryUniqueness,
} from './job-schema.mjs';

export class PilotAcquireError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotAcquireError';
  }
}

const INVENTORY_LOCK_TIMEOUT_MS = 10_000;
// Crash window between lock mkdir and the owner write: a holder that dies
// there leaves an ownerless directory. Fresh ownerless dirs are
// mid-acquire holders; ones older than this grace are crashed holders and
// recover like any other stale lock.
const INVENTORY_LOCK_OWNER_GRACE_MS = 5_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isBeyondOwnerGrace(lockDir) {
  const info = await stat(lockDir).catch(() => null);
  if (!info) {
    // Raced with a release: the next loop iteration retries the mkdir.
    return false;
  }
  return Date.now() - info.mtimeMs > INVENTORY_LOCK_OWNER_GRACE_MS;
}

export async function isStaleInventoryLock(lockDir) {
  const owner = await readFile(join(lockDir, 'owner.json'), 'utf8').catch(
    () => null
  );
  if (owner === null) {
    return isBeyondOwnerGrace(lockDir);
  }
  let parsed;
  try {
    parsed = JSON.parse(owner);
  } catch {
    // Torn read of an owner file still being written: exclusive-create
    // publishes the path before the bytes land, so a second acquirer can
    // observe a partial owner.json from a live holder. Unparsable owners
    // get the same creation grace as missing ones — only a lock that has
    // been unparsable past the grace is a crashed holder's.
    return isBeyondOwnerGrace(lockDir);
  }
  if (!Number.isInteger(parsed.pid)) {
    // No identity to probe; our writer always records an integer pid, so
    // this file is not from a live holder of ours.
    return true;
  }
  // Age alone never proves death: a stalled-but-live owner past any
  // timeout must never be stolen — the stealer would append alongside
  // the resumed original and silently lose records. Only ESRCH (no such
  // process) permits recovery; EPERM and every other outcome fail closed
  // as held (a wedged holder blocks appends loudly, never corruptly).
  try {
    process.kill(parsed.pid, 0);
  } catch (error) {
    return error?.code === 'ESRCH';
  }
  return false;
}

async function acquireInventoryLock(lockDir) {
  const deadline = Date.now() + INVENTORY_LOCK_TIMEOUT_MS;
  for (;;) {
    let fresh = false;
    try {
      await mkdir(lockDir);
      fresh = true;
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
    }
    if (fresh) {
      // The owner token binds this lock directory to this acquisition:
      // release removes the directory only while the token still matches,
      // so a stolen lock's replacement survives the victim's release.
      // The owner write is exclusive-create: a holder stalled past the
      // ownerless grace may find its directory renamed away and replaced
      // while it slept — a blind write would land in the replacement and
      // admit two concurrent appenders. EEXIST/ENOENT here means we lost
      // that race, so fall through and retry instead of appending.
      const token = randomUUID();
      try {
        await writeFile(
          join(lockDir, 'owner.json'),
          JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
            token,
          }),
          { flag: 'wx' }
        );
        return token;
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOENT') {
          throw error;
        }
      }
    }
    // Steal a crashed holder's lock instead of wedging every future append.
    // The steal is atomic-by-rename: two processes can both judge the same
    // lock stale, but only one wins the rename — the loser sees ENOENT and
    // retries instead of deleting the winner's replacement (an unchecked
    // rm here would admit two concurrent holders). Each stealer removes
    // only the directory IT renamed, never the live lock path.
    if (await isStaleInventoryLock(lockDir)) {
      const claimed = `${lockDir}.stale.${process.pid}.${randomUUID()}`;
      try {
        await rename(lockDir, claimed);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
        continue;
      }
      await rm(claimed, { force: true, recursive: true });
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

export async function releaseInventoryLock(lockDir, token) {
  const owner = await readFile(join(lockDir, 'owner.json'), 'utf8').catch(
    () => null
  );
  if (owner === null) {
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(owner);
  } catch {
    return;
  }
  if (parsed.token !== token) {
    return;
  }
  await rm(lockDir, { force: true, recursive: true });
}

export async function appendInventoryRecord(inventoryPath, record) {
  // Serialized: two concurrent appends must never read the same array and
  // overwrite each other, silently dropping an asset.
  const lockDir = `${inventoryPath}.lock`;
  const token = await acquireInventoryLock(lockDir);
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
    await releaseInventoryLock(lockDir, token);
  }
}
