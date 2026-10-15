// Stale-claim recovery for the host encoder lock: bounded record reads,
// pid-liveness classification, and atomic steal-with-restore. Split from
// encoder-lock.mjs under the repo line ceiling. Steal safety: the dead
// claim is moved aside with an atomic rename and re-verified before
// replacement — a live claim that replaced it between the read and the
// rename is restored (when the path is still free) instead of silently
// deleted. Residual: a third linker inside the microsecond verify window
// keeps the path while the moved live claim is preserved as evidence;
// both live processes then hold until one releases. Closing that needs
// flock, which Node does not expose.
import { randomBytes } from 'node:crypto';
import { link, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_ENCODER_LOCK_BYTES } from './constants.mjs';
import { readUpToBytes } from './disk-guards.mjs';
import { PilotGenerateError } from './generate-job.mjs';

// Lock reads go through the byte ceiling like job claims: oversized
// records classify corrupt instead of exhausting the reader.
export async function readLockText(path) {
  const { bytes, truncated } = await readUpToBytes(path, MAX_ENCODER_LOCK_BYTES);
  if (truncated) {
    throw new PilotGenerateError(
      'encoder-lock-corrupt',
      `encoder lock record exceeds ${MAX_ENCODER_LOCK_BYTES} bytes`
    );
  }
  return bytes.toString('utf8');
}

function holderAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process (dead). Anything else (notably EPERM for
    // an unowned live pid) counts as alive — never steal on doubt.
    return error?.code !== 'ESRCH';
  }
}

// Returns true when the caller may retry publication, false when the
// lock is held, or 'corrupt' when the file is unparseable or shapeless
// (atomic publication makes a mid-write corrupt read impossible, and
// the writer always records a pid plus a token).
export async function stealWhenStale(path, locksDir) {
  let text;
  try {
    text = await readLockText(path);
  } catch (error) {
    // Oversized classifies corrupt; a vanish means the holder released.
    if (error?.code === 'encoder-lock-corrupt') {
      return 'corrupt';
    }
    return true;
  }
  let holder = null;
  try {
    holder = JSON.parse(text);
  } catch {
    holder = null;
  }
  if (!holder || typeof holder !== 'object') {
    return 'corrupt';
  }
  // Shape before liveness: atomic publication means our writer's claims
  // always carry a positive integer pid and a token string, so a
  // well-formed-JSON-but-shapeless file ({}, [], a pid without a token)
  // is tampering or disk fault — never a holder mid-write. Treating it
  // as a dead claim would delete the lock and admit a second encoder
  // alongside a possibly live original; fail closed for the operator.
  if (
    !Number.isInteger(holder.pid) ||
    holder.pid <= 0 ||
    typeof holder.token !== 'string' ||
    holder.token.length === 0
  ) {
    return 'corrupt';
  }
  if (holderAlive(holder.pid)) {
    // Live pid: held, at any age. Never evict on elapsed time.
    return false;
  }
  // Dead claim: move it aside atomically, then verify the moved file is
  // the claim just read. A plain unlink-then-create would silently
  // delete a live claim that replaced the dead one between the read
  // and the removal, leaving two live processes believing they hold
  // the lock.
  const recovery = join(
    locksDir,
    `recovering-${holder.token ?? 'untokened'}-${process.pid}-${randomBytes(8).toString('hex')}.tmp`
  );
  try {
    await rename(path, recovery);
  } catch (error) {
    // Already stolen or released between the read and the rename.
    if (error?.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
  const moved = await readLockText(recovery).catch(() => null);
  let movedHolder = null;
  try {
    movedHolder = moved ? JSON.parse(moved) : null;
  } catch {
    movedHolder = null;
  }
  if (movedHolder?.token !== holder.token || movedHolder?.pid !== holder.pid) {
    // A live claim replaced the dead one mid-steal: restore it when the
    // path is still free, then stand down. If a third linker already
    // claimed the path, the moved file stays as operator evidence.
    const restored = await link(recovery, path)
      .then(() => true)
      .catch(() => false);
    if (restored) {
      await unlink(recovery).catch(() => undefined);
    }
    return false;
  }
  await unlink(recovery).catch(() => undefined);
  return true;
}
