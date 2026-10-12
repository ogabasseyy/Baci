// Serialized inventory writer for the merchant image pilot: two
// concurrent appends must never read the same array and overwrite each
// other, silently dropping an asset.
//
// Locking is a mkdir-exclusive directory with an owner file. Stale locks
// (crashed holders) are stolen after bounded timeouts, and release is
// ownership-checked: a slow append whose lock was stolen must not delete
// the replacement and admit a third appender alongside it.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class PilotAcquireError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PilotAcquireError';
  }
}

// Thrown when the lock a critical section holds is replaced under it
// (a steal-race loser renamed the live directory away). Distinct from a
// timeout: the section's read-then-publish may have interleaved with
// another holder, so callers must stay loud, never swallow this as a
// retryable contention signal.
export class PilotInventoryEvictedError extends PilotAcquireError {
  constructor(message) {
    super(message);
    this.name = 'PilotInventoryEvictedError';
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

function readOwnerText(lockDir) {
  return readFile(join(lockDir, 'owner.json'), 'utf8').catch(() => null);
}

async function isStaleOwnerText(lockDir, owner) {
  if (owner === null) {
    return await isBeyondOwnerGrace(lockDir);
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
    return await isBeyondOwnerGrace(lockDir);
  }
  // Strictly positive: kill(0, 0) probes the current process GROUP
  // (always live) and negative PIDs probe process groups, so a pid-0 or
  // negative owner would classify as permanently live and make every
  // acquisition time out. Our writer always records a positive integer
  // pid, and a torn write cannot parse as valid JSON, so any other
  // value is a corrupt owner — stale, never held.
  if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) {
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

export async function isStaleInventoryLock(lockDir) {
  return isStaleOwnerText(lockDir, await readOwnerText(lockDir));
}

export async function acquireInventoryLock(lockDir, hooks = {}) {
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
      } catch (error) {
        if (error?.code !== 'EEXIST' && error?.code !== 'ENOENT') {
          throw error;
        }
        continue;
      }
      // Revalidate before entering: the write above can complete through
      // an already-open descriptor after a stealer renamed our directory
      // away (partial owner observed past the grace), landing our bytes
      // in the deleted directory while a replacement lock certifies
      // another appender. Entering on the write's success alone would
      // run two critical sections concurrently and silently drop a
      // record — so the claim counts only when our complete record is
      // readable at the live path. A stealer acting after that sees a
      // live owner and backs off, which closes the race both ways.
      await hooks.afterOwnerWrite?.();
      const live = await readFile(join(lockDir, 'owner.json'), 'utf8').catch(
        () => null
      );
      let liveToken = null;
      if (live !== null) {
        try {
          liveToken = JSON.parse(live).token ?? null;
        } catch {
          liveToken = null;
        }
      }
      if (liveToken === token) {
        return token;
      }
    }
    // Steal a crashed holder's lock instead of wedging every future append.
    // The observed owner bytes are captured BEFORE the staleness verdict:
    // a rival replacement published between a stale verdict and the
    // rename must be detected, not deleted.
    const observed = await readOwnerText(lockDir);
    if (await isStaleOwnerText(lockDir, observed)) {
      const claimed = `${lockDir}.stale.${process.pid}.${randomUUID()}`;
      await hooks.beforeStaleRename?.();
      try {
        await rename(lockDir, claimed);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
        continue;
      }
      // Verify the moved directory is the stale lock inspected: two
      // contenders can both judge the same crashed lock stale, and the
      // loser may rename away the winner's live replacement instead.
      // Deleting it would admit two concurrent holders overwriting each
      // other's inventory updates — restore it and retry. Residual: a
      // third contender can mkdir into the microsecond rename-restore
      // window (no flock available), in which case the restore fails and
      // the evicted holder's pre-publish ownership check refuses to
      // rename — fail-safe, with the rival's publish left intact. The
      // end-of-section check stays as the backstop for an eviction in
      // the check-then-rename window itself.
      const moved = await readOwnerText(claimed);
      if (moved !== observed) {
        try {
          await rename(claimed, lockDir);
        } catch {
          await rm(claimed, { force: true, recursive: true });
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

// Lock ownership check: a steal-race loser can rename this section's
// live lock away mid-section (see the restore race above), in which
// case the section ran concurrently with another holder. Publishing
// sections call this BEFORE the rename (fail-safe refusal); the
// end-of-section call in withInventoryLock stays as the backstop that
// fails loudly so the operator reconciles instead of trusting a
// silently torn inventory. Live holders are never ESRCH-stolen, so a
// mismatch here is always a real eviction, never a false positive.
export async function assertInventoryLockHeld(lockDir, token) {
  const owner = await readOwnerText(lockDir);
  let liveToken = null;
  if (owner !== null) {
    try {
      liveToken = JSON.parse(owner).token ?? null;
    } catch {
      liveToken = null;
    }
  }
  if (liveToken !== token) {
    throw new PilotInventoryEvictedError(
      `acquire: inventory lock ${lockDir} changed owner during the critical section; records may be inconsistent — verify the inventory and retry`
    );
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
