import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { MAX_CLAIM_BYTES } from './constants.mjs';
import {
  ownedStagingPath,
  readUpToBytes,
  removeOwnedStaging,
} from './disk-guards.mjs';
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
  // PIDs must be strictly positive: kill(0, 0) probes the current
  // process GROUP (always live) and negative PIDs probe process groups,
  // so a pid-0 claim would classify as a live owner and block the asset
  // as claim-held forever instead of failing as the corrupt file it is.
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof parsed.runToken !== 'string' ||
    typeof parsed.pid !== 'number' ||
    !Number.isInteger(parsed.pid) ||
    parsed.pid <= 0 ||
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

// Claim reads go through the byte ceiling: a corrupt or replaced
// multi-gigabyte claim must reject as claim-corrupt instead of
// exhausting the contender before the shape check runs. Read errors
// propagate raw (like readFile's) so callers keep their ENOENT mapping.
async function readClaimText(path) {
  const { bytes, truncated } = await readUpToBytes(path, MAX_CLAIM_BYTES);
  if (truncated) {
    throw new PilotClaimError(
      'claim-corrupt',
      `claim file exceeds ${MAX_CLAIM_BYTES} bytes`
    );
  }
  return bytes.toString('utf8');
}

function ownerExited(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

export async function acquireClaim(outputRoot, job, runToken) {
  // Claims live under the output root like generations and reports: a
  // symlinked claims dir would publish claim temp files and the job claim
  // outside the configured root (recursive mkdir follows symlinks), so
  // confine it with the same lstat/realpath check before publishing.
  const claimsDir = join(outputRoot, 'claims');
  await mkdir(claimsDir, { recursive: true });
  const claimsInfo = await lstat(claimsDir);
  if (
    claimsInfo.isSymbolicLink() ||
    !claimsInfo.isDirectory() ||
    (await realpath(claimsDir)) !== join(await realpath(outputRoot), 'claims')
  ) {
    throw new PilotClaimError(
      'unsafe-claims-directory',
      'claims must be a confined directory, not a symlink'
    );
  }
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
  const existing = parseClaimFile(await readClaimText(path));
  throw new PilotClaimError(
    'claim-held',
    `job is claimed by run "${existing.runToken}" (pid ${existing.pid})`,
    { ownerPid: existing.pid, runToken: existing.runToken }
  );
}

export async function releaseClaim(outputRoot, job, runToken) {
  const path = claimPath(outputRoot, job);
  // Atomic release, mirroring the encoder-lock protocol: move the
  // pathname aside, then verify the MOVED file is our claim before
  // deleting. Read-then-unlink would delete a successor's claim
  // published between the read and the unlink, leaving its live
  // staging dir claimless to recovery and sweep code. A foreign or
  // corrupt moved-aside claim is restored (link fails closed when a
  // successor already claimed the path; the stray .tmp then lingers
  // inert — never read as a claim) before refusing.
  const releasing = join(
    outputRoot,
    'claims',
    `releasing-${runToken}-${process.pid}-${randomUUID()}.tmp`
  );
  try {
    await rename(path, releasing);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
  let movedToken;
  try {
    movedToken = parseClaimFile(await readClaimText(releasing)).runToken;
  } catch (error) {
    await restoreReleasedClaim(releasing, path);
    throw error;
  }
  if (movedToken !== runToken) {
    await restoreReleasedClaim(releasing, path);
    throw new PilotClaimError(
      'claim-foreign',
      'refusing to release a foreign run token claim'
    );
  }
  await unlink(releasing).catch(() => undefined);
  return true;
}

async function restoreReleasedClaim(releasing, path) {
  const restored = await link(releasing, path)
    .then(() => true)
    .catch(() => false);
  if (restored) {
    await unlink(releasing).catch(() => undefined);
  }
}

export async function recoverAbandonedClaim(outputRoot, job) {
  const path = claimPath(outputRoot, job);
  const text = await readClaimText(path).catch((error) => {
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
