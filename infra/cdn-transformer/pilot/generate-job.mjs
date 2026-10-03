// Per-job generation runner for the merchant image pilot: claim,
// snapshot validation, staged encoding, never-larger delivery guard,
// and atomic commit for one inventory job. Orchestration (inventory
// fan-out, report writing) and the executable CLI stay in
// generate.mjs.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JOB_TIMEOUT_MS } from './constants.mjs';
import {
  acquireClaim,
  createRunToken,
  recoverAbandonedClaim,
  releaseClaim,
} from './claims.mjs';
import {
  assertMinFreeBytes,
  createStagingBudget,
  ownedStagingPath,
  removeOwnedStaging,
} from './disk-guards.mjs';
import { applyDeliveryGuard } from './delivery.mjs';
import { encodeRoleLadder } from './encoder.mjs';
import { takePeakWorkerRssBytes } from './worker-pool.mjs';
import { readInputSnapshot, verifySnapshotHash } from './input-store.mjs';
import {
  buildEncoderIdentity,
  commitGeneration,
  currentRecipeId,
  generationIdFor,
  outputFileName,
} from './manifest.mjs';

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


export async function runJob({ inputRoot, job, minFreeBytes, outputRoot }) {
  const startedAt = Date.now();
  const deadlineMs = startedAt + JOB_TIMEOUT_MS;
  // Memory accounting: parent RSS sampled at checkpoints, plus the max
  // worker-child RSS across this job's completed ops (self-reported per
  // op envelope; see encode-worker.mjs). Parent and worker run
  // concurrently, so their peaks sum to a CONSERVATIVE upper bound on the
  // combined job peak — safe to size capacity, unlike the parent sample
  // alone. Missed: peaks between parent samples, and spikes inside one
  // native worker call (bounded by the worker's input pixel limits).
  const startedRss = process.memoryUsage().rss;
  let sampledParentRss = startedRss;
  const sampleRss = () => {
    sampledParentRss = Math.max(sampledParentRss, process.memoryUsage().rss);
  };
  takePeakWorkerRssBytes();
  const runToken = createRunToken();
  let stagingDir = null;
  try {
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
      throw new PilotGenerateError('source-mismatch', 'source bytes differ from the validated hash');
    }
    assertJobDeadline(deadlineMs, 'snapshot');
    stagingDir = ownedStagingPath(outputRoot, claim.runToken);
    await mkdir(stagingDir, { recursive: true });
    const frozenCopy = join(stagingDir, 'source.snapshot');
    await writeFile(frozenCopy, snapshot.bytes, { flag: 'wx' });
    assertJobDeadline(deadlineMs, 'staging');
    const stagingBudget = createStagingBudget();
    stagingBudget.charge(snapshot.bytes.length);
    sampleRss();
    const ladder = await encodeRoleLadder({
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
    const sourceFacts = {
      bytes: snapshot.bytes.length,
      format: ladder.source.format,
      orientedHeight: ladder.source.orientedHeight,
      orientedWidth: ladder.source.orientedWidth,
      sha256: job.expectedSha256,
    };
    // Never-larger delivery guard: per-rung body-byte decision against the
    // hash-verified snapshot. Pass-through rungs reuse the validated source
    // bytes (committed as copies below); nothing here re-reads or rehashes
    // loosely — commitGeneration re-verifies every staged file.
    const decided = applyDeliveryGuard({
      source: sourceFacts,
      tiers: ladder.tiers,
    });
    const stagedPassthrough = new Map();
    const passthroughFrom = async (format) => {
      const cached = stagedPassthrough.get(format);
      if (cached) {
        return cached;
      }
      const from = join(stagingDir, `passthrough.${format}`);
      await writeFile(from, snapshot.bytes, { flag: 'wx' });
      stagingBudget.charge(snapshot.bytes.length);
      stagedPassthrough.set(format, from);
      return from;
    };
    const manifestTiers = [];
    for (const tier of decided) {
      const sha256 =
        tier.delivery === 'original-passthrough'
          ? job.expectedSha256
          : tier.sha256;
      manifestTiers.push({
        actualWidth: tier.actualWidth,
        bytes: tier.bytes,
        contentType: tier.contentType,
        delivery: tier.delivery,
        format: tier.format,
        height: tier.height,
        path: outputFileName(sha256, tier.format),
        quality: tier.quality,
        requestedWidth: tier.requestedWidth,
        sha256,
        width: tier.width,
      });
    }
    const manifest = {
      assetId: job.assetId,
      createdAt: new Date().toISOString(),
      encoder: encoderIdentity,
      merchantId: job.merchantId,
      policyVersion: 1,
      recipeId,
      role: job.role,
      schemaVersion: 1,
      source: sourceFacts,
      tiers: manifestTiers,
    };
    const seen = new Set();
    const files = [];
    for (const tier of decided) {
      const sha256 =
        tier.delivery === 'original-passthrough'
          ? job.expectedSha256
          : tier.sha256;
      const name = outputFileName(sha256, tier.format);
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);
      const from =
        tier.delivery === 'original-passthrough'
          ? await passthroughFrom(tier.format)
          : tier.path;
      files.push({ from, name });
    }
    await assertPreCommitGuards({ deadlineMs, minFreeBytes, outputRoot });
    const committed = await commitGeneration({
      files,
      generationId,
      job,
      manifest,
      outputRoot,
      stagingDir,
    });
    assertJobDeadline(deadlineMs, 'commit');
    sampleRss();
    await releaseClaim(outputRoot, job, claim.runToken);
    if (!committed.reused) {
      await removeOwnedStaging(outputRoot, stagingDir).catch(() => {});
    }
    stagingDir = null;
    const peakWorkerRssBytes = takePeakWorkerRssBytes();
    return {
      assetId: job.assetId,
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
    if (stagingDir) {
      await removeOwnedStaging(outputRoot, stagingDir).catch(() => {});
    }
    await releaseClaim(outputRoot, job, runToken).catch(() => {});
    const peakWorkerRssBytes = takePeakWorkerRssBytes();
    return {
      assetId: job.assetId,
      code: error?.code ?? 'unknown',
      elapsedMs: Date.now() - startedAt,
      merchantId: job.merchantId,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      peakCombinedUpperBoundBytes: sampledParentRss + peakWorkerRssBytes,
      peakWorkerRssBytes,
      sampledParentRssBytes: sampledParentRss,
      role: job.role,
      status: 'failed',
    };
  }
}
