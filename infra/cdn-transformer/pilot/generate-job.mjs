// Per-job generation runner for the merchant image pilot: claim,
// snapshot validation, staged encoding, never-larger delivery guard,
// and atomic commit for one inventory job. Orchestration (inventory
// fan-out, report writing) and the executable CLI stay in
// generate.mjs.
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  acquireClaim,
  createRunToken,
  recoverAbandonedClaim,
  releaseClaim,
} from './claims.mjs';
import {
  cleanupCommittedAttempt,
  cleanupFailedAttempt,
  sweepOrphanedStaging,
} from './claims-cleanup.mjs';
import { JOB_TIMEOUT_MS } from './constants.mjs';
import {
  assertMinFreeBytes,
  createStagingBudget,
  ownedStagingPath,
  removeOwnedStaging,
  writeConfinedFile,
} from './disk-guards.mjs';
import { encodeRoleLadder } from './encoder.mjs';
import { buildDisposition } from './generate-disposition.mjs';
import { readInputSnapshot, verifySnapshotHash } from './input-store.mjs';
import {
  buildEncoderIdentity,
  currentRecipeId,
  generationIdFor,
} from './manifest.mjs';
import { commitGeneration } from './manifest-store.mjs';
import { takeWorkerPeaks } from './worker-pool.mjs';

export class PilotGenerateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PilotGenerateError';
  }
}

// Phase-boundary deadline guard: the absolute job deadline previously
// reached only the encoder, so slow claim/snapshot/staging/commit phases
// could blow past the 120s cap (or hold a claim indefinitely while making
// no progress). Every throw here funnels through runJob's catch, which
// releases the claim and reports 'failed' instead of hanging or lying.
// Residual: a truly wedged storage syscall cannot be interrupted from this
// process; these checks bound slow phases, not hung syscalls.
export function assertJobDeadline(deadlineMs, phase) {
  if (Date.now() > deadlineMs) {
    throw new PilotGenerateError(
      'deadline-exceeded',
      `job exceeded its ${JOB_TIMEOUT_MS}ms budget during ${phase}`
    );
  }
}

// Pre-commit guards: the deadline AND the disk floor are rechecked
// immediately before publication. Encoding can run up to the 120s job
// budget, and another process may consume disk meanwhile — the pre-claim
// floor check alone cannot prove 2 GiB are still free at commit time.
export async function assertPreCommitGuards({
  deadlineMs,
  minFreeBytes,
  outputRoot,
}) {
  assertJobDeadline(deadlineMs, 'pre-commit');
  await assertMinFreeBytes(outputRoot, minFreeBytes);
}

// Owned staging establishment: exclusive create plus confinement
// verification. The run token is visible in the published claim, so a
// pre-planted symlink must fail here instead of being followed by
// recursive creation (whose snapshot and encoder outputs would land
// outside the output root). EEXIST is verified, not trusted:
// crash-recovery reruns legitimately find their own directory, but a
// symlink, file, or escape fails closed before the first snapshot write.
export async function prepareOwnedStaging(outputRoot, runToken) {
  const stagingDir = ownedStagingPath(outputRoot, runToken);
  try {
    await mkdir(stagingDir);
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
  }
  const info = await lstat(stagingDir);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(stagingDir)) !==
      join(await realpath(outputRoot), `staging-${runToken}`)
  ) {
    throw new PilotGenerateError(
      'unsafe-staging-directory',
      'staging must be a confined directory, not a symlink'
    );
  }
  return stagingDir;
}

export async function runJob({
  deps,
  encoderLock,
  inputRoot,
  job,
  minFreeBytes,
  outputRoot,
}) {
  const releaseClaimFn = deps?.releaseClaim ?? releaseClaim;
  const removeStagingFn = deps?.removeOwnedStaging ?? removeOwnedStaging;
  const startedAt = Date.now();
  const deadlineMs = startedAt + JOB_TIMEOUT_MS;
  // Memory accounting: parent RSS sampled at checkpoints, plus the max
  // worker-child RSS across this job's completed ops (self-reported per
  // op envelope; see encode-worker.mjs). Parent and worker run
  // concurrently, so their peaks sum to a CONSERVATIVE upper bound on the
  // combined job peak — safe to size capacity, unlike the parent sample
  // alone. Missed: peaks between parent samples, and spikes inside one
  // native worker call (bounded by the worker's input pixel limits).
  // Ops that die without an envelope (timeout/crash/kill) contribute no
  // peak, so the envelope marks the sum incomplete instead of omitting
  // the worst inputs from capacity evidence.
  const startedRss = process.memoryUsage().rss;
  let sampledParentRss = startedRss;
  const sampleRss = () => {
    sampledParentRss = Math.max(sampledParentRss, process.memoryUsage().rss);
  };
  takeWorkerPeaks();
  const runToken = createRunToken();
  let stagingDir = null;
  try {
    // A run evicted by a steal-race loser must not claim, stage, or
    // encode: fail this job fast instead of acting alongside the
    // successor. The per-attempt check in encodeVariant covers
    // evictions that land mid-job.
    await encoderLock?.assertHeld?.();
    // Reap staging dirs stranded by earlier attempts whose removal
    // failed after their claim released; best-effort, never fatal.
    await sweepOrphanedStaging(outputRoot).catch(() => {});
    await assertMinFreeBytes(outputRoot, minFreeBytes);
    let claim;
    try {
      claim = await acquireClaim(outputRoot, job, runToken);
    } catch (error) {
      if (error?.code !== 'claim-held') {
        throw error;
      }
      await recoverAbandonedClaim(outputRoot, job);
      claim = await acquireClaim(outputRoot, job, runToken);
    }
    assertJobDeadline(deadlineMs, 'claim');
    sampleRss();
    const snapshot = await readInputSnapshot(inputRoot, job.sourcePath);
    if (!verifySnapshotHash(snapshot, job.expectedSha256)) {
      throw new PilotGenerateError(
        'source-mismatch',
        'source bytes differ from the validated hash'
      );
    }
    assertJobDeadline(deadlineMs, 'snapshot');
    stagingDir = await prepareOwnedStaging(outputRoot, claim.runToken);
    // The run token is published in the claim, so a contender can race
    // this freeze: a plain writeFile would follow a swapped-in parent
    // symlink outside the output root ('wx' guards only the final
    // component). The confined write re-binds the parent around the
    // open and refuses when the binding breaks.
    await writeConfinedFile(stagingDir, 'source.snapshot', snapshot.bytes);
    const frozenCopy = join(stagingDir, 'source.snapshot');
    assertJobDeadline(deadlineMs, 'staging');
    const stagingBudget = createStagingBudget();
    stagingBudget.charge(snapshot.bytes.length);
    sampleRss();
    const ladder = await encodeRoleLadder({
      assertEncoderHeld: encoderLock
        ? () => encoderLock.assertHeld()
        : undefined,
      deadlineMs,
      expectedSha256: job.expectedSha256,
      role: job.role,
      snapshotPath: frozenCopy,
      stagingBudget,
      stagingDir,
    });
    sampleRss();
    const encoderIdentity = buildEncoderIdentity();
    const recipeId = currentRecipeId();
    const generationId = generationIdFor({
      encoderIdentity,
      job,
      recipeId,
      sourceSha256: job.expectedSha256,
    });
    const { files, manifest } = await buildDisposition({
      encoderIdentity,
      job,
      ladder,
      recipeId,
      snapshot,
      stagingBudget,
      stagingDir,
    });
    await assertPreCommitGuards({ deadlineMs, minFreeBytes, outputRoot });
    const committed = await commitGeneration({
      deps: {
        assertDeadline: () => assertJobDeadline(deadlineMs, 'commit'),
        removeOwnedStaging: removeStagingFn,
      },
      files,
      generationId,
      job,
      manifest,
      outputRoot,
      stagingDir,
    });
    // No post-commit deadline throw: the deadline is enforced BEFORE the
    // visibility rename (inside commitGeneration). Past that point only a
    // rename and a directory fsync remain — a throw cannot interrupt them,
    // it would only report failed-but-published. elapsedMs stays visible.
    sampleRss();
    const cleanupWarning = await cleanupCommittedAttempt({
      committed,
      generationId,
      job,
      outputRoot,
      releaseClaimFn,
      removeStagingFn,
      runToken: claim.runToken,
      stagingDir,
    });
    stagingDir = null;
    const { failedWorkerOps, peakWorkerRssBytes } = takeWorkerPeaks();
    return {
      assetId: job.assetId,
      ...(cleanupWarning ? { cleanupWarning } : {}),
      ...(failedWorkerOps > 0 ? { workerPeakIncomplete: true } : {}),
      durability: committed.durability,
      elapsedMs: Date.now() - startedAt,
      generationId,
      merchantId: job.merchantId,
      peakCombinedUpperBoundBytes: sampledParentRss + peakWorkerRssBytes,
      peakWorkerRssBytes,
      sampledParentRssBytes: sampledParentRss,
      reused: committed.reused,
      role: job.role,
      stagedBytes: stagingBudget.used,
      status: 'ok',
      tiers: manifest.tiers.map((tier) => ({
        bytes: tier.bytes,
        delivery: tier.delivery,
        format: tier.format,
        height: tier.height,
        quality: tier.quality,
        requestedWidth: tier.requestedWidth,
        width: tier.width,
      })),
    };
  } catch (error) {
    sampleRss();
    const stagingCleanupError = await cleanupFailedAttempt({
      job,
      outputRoot,
      releaseClaimFn,
      removeStagingFn,
      runToken,
      stagingDir,
    });
    const { failedWorkerOps, peakWorkerRssBytes } = takeWorkerPeaks();
    return {
      assetId: job.assetId,
      code: error?.code ?? 'unknown',
      ...(stagingCleanupError ? { stagingCleanupError } : {}),
      ...(failedWorkerOps > 0 ? { workerPeakIncomplete: true } : {}),
      elapsedMs: Date.now() - startedAt,
      merchantId: job.merchantId,
      message: (error instanceof Error ? error.message : String(error)).slice(
        0,
        500
      ),
      peakCombinedUpperBoundBytes: sampledParentRss + peakWorkerRssBytes,
      peakWorkerRssBytes,
      sampledParentRssBytes: sampledParentRss,
      role: job.role,
      status: 'failed',
    };
  }
}
