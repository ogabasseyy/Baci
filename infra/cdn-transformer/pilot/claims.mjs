import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ownedStagingPath, removeOwnedStaging } from './disk-guards.mjs';
import { pilotJobKey } from './job-schema.mjs';

export class PilotClaimError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.name = 'PilotClaimError';
    Object.assign(this, details);
  }
}

export function createRunToken() {
  return randomUUID();
}

export function claimKeyForJob(job) {
  return createHash('sha256').update(pilotJobKey(job)).digest('hex');
}

function claimPath(outputRoot, job) {
  return join(outputRoot, 'claims', `${claimKeyForJob(job)}.json`);
}

function parseClaimFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PilotClaimError('claim-corrupt', 'claim file is not valid JSON');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.runToken !== 'string' ||
    typeof parsed.pid !== 'number' ||
    !Number.isInteger(parsed.pid) ||
    typeof parsed.stagingDirName !== 'string'
  ) {
    throw new PilotClaimError('claim-corrupt', 'claim file has a bad shape');
  }
  return parsed;
}

// Liveness is proven ONLY by signal delivery. kill(pid, 0) succeeding means
// the owner may be live OR the pid was reused by an unrelated process.
// Only ESRCH (no such process) proves the owner exited. EPERM and every
// other outcome fail closed as held.
function ownerExited(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

export async function acquireClaim(outputRoot, job, runToken) {
  await mkdir(join(outputRoot, 'claims'), { recursive: true });
  const path = claimPath(outputRoot, job);
  const stagingDirName = `staging-${runToken}`;
  // Validate the staging path shape up front so recovery can rely on it.
  ownedStagingPath(outputRoot, runToken);
  const claim = {
    createdAt: new Date().toISOString(),
    jobKey: pilotJobKey(job),
    ownerStartApproxMs: Date.now() - Math.round(process.uptime() * 1000),
    pid: process.pid,
    runToken,
    stagingDirName,
  };
  // Atomic publication: write the complete claim to a unique temp file,
  // then hard-link it onto the claim path. link(2) is atomic and fails
  // with EEXIST when beaten, so a kill can never leave an empty or
  // partial claim behind (an exclusive-create followed by a separate
  // content write could, permanently blocking the asset: claim-corrupt
  // is unrecoverable because a torn file carries no owner identity).
  // Orphaned temp files from a mid-publish kill are inert and safe for
  // operators to delete.
  const tempPath = join(
    outputRoot,
    'claims',
    `claim-${runToken}-${process.pid}-${randomUUID()}.tmp`
  );
  await writeFile(tempPath, JSON.stringify(claim, null, 2), { flag: 'wx' });
  let linked = false;
  try {
    await link(tempPath, path);
    linked = true;
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
  } finally {
    // Always drop our temp name: on success the claim keeps the content
    // via its own link; on a lost race this removes our scratch file.
    await unlink(tempPath).catch(() => {
      // Best-effort cleanup; the temp name is unique and inert.
    });
  }
  if (linked) {
    return claim;
  }
  const existing = parseClaimFile(await readFile(path, 'utf8'));
  throw new PilotClaimError(
    'claim-held',
    `job is claimed by run "${existing.runToken}" (pid ${existing.pid})`,
    { ownerPid: existing.pid, runToken: existing.runToken }
  );
}

export async function releaseClaim(outputRoot, job, runToken) {
  const path = claimPath(outputRoot, job);
  const text = await readFile(path, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (text === null) {
    return false;
  }
  const existing = parseClaimFile(text);
  if (existing.runToken !== runToken) {
    throw new PilotClaimError(
      'claim-foreign',
      'refusing to release a foreign run token claim'
    );
  }
  await unlink(path).catch((error) => {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  });
  return true;
}

export async function recoverAbandonedClaim(outputRoot, job) {
  const path = claimPath(outputRoot, job);
  const text = await readFile(path, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new PilotClaimError('claim-missing', 'no claim file to recover');
    }
    throw error;
  });
  const existing = parseClaimFile(text);
  // A pid that answers kill(2) is held unconditionally: age cannot
  // distinguish a wedged-but-live owner from pid reuse, and recovering a
  // wedged owner's staging while it can still resume would violate the
  // single-job guarantee. Wedged or pid-reused claims need operator
  // clearance (the claim records pid + owner start for diagnosis).
  if (!ownerExited(existing.pid)) {
    throw new PilotClaimError(
      'claim-held',
      `owner pid ${existing.pid} may be live; refusing to steal run "${existing.runToken}"`,
      { ownerPid: existing.pid, runToken: existing.runToken }
    );
  }
  // Owner provably exited (ESRCH): remove ONLY that run's staging after
  // revalidating the path beneath the output root, then drop the claim.
  const stagingDir = ownedStagingPath(outputRoot, existing.runToken);
  if (basename(stagingDir) !== existing.stagingDirName) {
    throw new PilotClaimError(
      'claim-corrupt',
      'claim staging name does not match its run token'
    );
  }
  let removedStaging = false;
  try {
    await removeOwnedStaging(outputRoot, stagingDir);
    removedStaging = true;
  } catch (error) {
    if (!/missing/.test(error?.message ?? '')) {
      throw error;
    }
  }
  await releaseClaim(outputRoot, job, existing.runToken);
  return { removedStaging, runToken: existing.runToken };
}
