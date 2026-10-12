// Failed-attempt and orphaned-staging cleanup for the merchant image
// pilot: retried removal, recorded stranded paths, and a bounded sweep.
// Split from generate-job.mjs under the repo line ceiling.
import { lstat, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { MAX_CLAIM_BYTES } from './constants.mjs';
import {
  ownedStagingPath,
  readUpToBytes,
  removeOwnedStaging,
  STAGING_DIR_PREFIX,
} from './disk-guards.mjs';

// EBUSY/EACCES from a just-exited worker is often transient (lingering
// handles close in milliseconds), so removal retries briefly before
// the attempt records a stranded dir.
export async function removeStagingWithRetry(
  outputRoot,
  stagingDir,
  removeFn,
  attempts = 3
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await removeFn(outputRoot, stagingDir);
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) =>
          setTimeout(resolve, 25 * (attempt + 1))
        );
      }
    }
  }
  throw lastError;
}

// Post-commit teardown: release the claim, then remove staging (a
// reuse-path removal failure seeded in commitGeneration gets exactly
// one retry here). Past the visibility rename the generation is
// durable, so failures record as a warning while the job still reports
// the true published outcome — never failed-but-published.
export async function cleanupCommittedAttempt({
  committed,
  generationId,
  job,
  outputRoot,
  releaseClaimFn,
  removeStagingFn,
  runToken,
  stagingDir,
}) {
  let cleanupWarning = committed.stagingCleanupError ?? null;
  try {
    await releaseClaimFn(outputRoot, job, runToken);
    if (!committed.reused) {
      await removeStagingFn(outputRoot, stagingDir);
    } else if (cleanupWarning) {
      await removeStagingFn(outputRoot, stagingDir);
      cleanupWarning = null;
    }
  } catch (error) {
    const fresh =
      `post-commit cleanup failed (${error?.code ?? 'unknown'}): ` +
      `${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        200
      ) +
      `; generation ${generationId} is published and reusable`;
    cleanupWarning = cleanupWarning ? `${cleanupWarning}; ${fresh}` : fresh;
  }
  return cleanupWarning;
}

// Failed-attempt teardown: remove staging (retried), then always
// release the claim. A kept claim would read as held-by-live-owner and
// break the immediate same-process retry, so a persistent removal
// failure releases anyway and records the stranded dir name — the
// claimless dir becomes sweepable at the next job start (below).
// Returns the cleanup error text, or null when nothing stranded.
export async function cleanupFailedAttempt({
  job,
  outputRoot,
  releaseClaimFn,
  removeStagingFn,
  runToken,
  stagingDir,
}) {
  let stagingCleanupError = null;
  if (stagingDir) {
    try {
      await removeStagingWithRetry(outputRoot, stagingDir, removeStagingFn);
    } catch (error) {
      stagingCleanupError =
        `staging cleanup failed (${error?.code ?? 'unknown'}): ` +
        `${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          200
        ) +
        `; stranded ${basename(stagingDir)}`;
    }
  }
  await releaseClaimFn(outputRoot, job, runToken).catch(() => {
    // Best-effort: claim release must not mask the job failure.
  });
  return stagingCleanupError;
}

// Bounded cleanup for stranded staging dirs. Runs at job start under
// the encoder lock before this job acquires: claims are acquired
// before staging exists and released after it is removed, so a staging
// dir no live claim references is unreachable by any live run. Only
// dirs older than the linger window reap, so a concurrent release-then-
// remove window (success path) is never mistaken for an orphan.
// Returns the reaped dir names. Never throws: sweep failures leave
// orphans for the next sweep, and the disk-floor gate backstops.
export async function sweepOrphanedStaging(outputRoot, nowMs = Date.now()) {
  let names;
  try {
    names = await readdir(outputRoot);
  } catch {
    return [];
  }
  let claimFiles;
  try {
    claimFiles = await readdir(join(outputRoot, 'claims'));
  } catch {
    claimFiles = [];
  }
  const live = new Set();
  for (const file of claimFiles) {
    if (!file.endsWith('.json')) {
      continue;
    }
    try {
      const { bytes, truncated } = await readUpToBytes(
        join(outputRoot, 'claims', file),
        MAX_CLAIM_BYTES
      );
      if (truncated) {
        continue;
      }
      const parsed = JSON.parse(bytes.toString('utf8'));
      if (typeof parsed?.runToken === 'string') {
        live.add(`${STAGING_DIR_PREFIX}${parsed.runToken}`);
      }
      if (typeof parsed?.stagingDirName === 'string') {
        live.add(parsed.stagingDirName);
      }
    } catch {
      // Corrupt or unreadable claims are recovered, not swept past.
    }
  }
  const reaped = [];
  for (const name of names) {
    if (!name.startsWith(STAGING_DIR_PREFIX) || live.has(name)) {
      continue;
    }
    let stagingDir;
    try {
      stagingDir = ownedStagingPath(
        outputRoot,
        name.slice(STAGING_DIR_PREFIX.length)
      );
    } catch {
      continue;
    }
    // Linger window: a claimless staging dir younger than 5s is a
    // concurrent release-then-remove window, not an orphan.
    const info = await lstat(stagingDir).catch(() => null);
    if (!info || nowMs - info.mtimeMs < 5000) {
      continue;
    }
    try {
      await removeOwnedStaging(outputRoot, stagingDir);
      reaped.push(name);
    } catch {
      // Next sweep retries; the disk-floor gate backstops.
    }
  }
  return reaped;
}
