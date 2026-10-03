import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ENCODER_OPTIONS,
  JOB_TIMEOUT_MS,
  MIN_FREE_BYTES,
  QUALITY_LADDER,
  RECIPE_CANONICAL_JSON,
  RECIPE_ID,
} from './constants.mjs';
import {
  acquireClaim,
  createRunToken,
  recoverAbandonedClaim,
  releaseClaim,
} from './claims.mjs';
import { parseCliArgs } from './cli-args.mjs';
import {
  assertMinFreeBytes,
  createStagingBudget,
  ownedStagingPath,
  removeOwnedStaging,
} from './disk-guards.mjs';
import { applyDeliveryGuard } from './delivery.mjs';
import { encodeRoleLadder } from './encoder.mjs';
import { readInputSnapshot, verifySnapshotHash } from './input-store.mjs';
import { readInventoryJobs } from './job-schema.mjs';
import {
  buildEncoderIdentity,
  commitGeneration,
  currentRecipeId,
  generationIdFor,
  outputFileName,
} from './manifest.mjs';

const here = dirname(fileURLToPath(import.meta.url));

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

async function findPnpmPin() {
  let dir = here;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'package.json');
    try {
      const pkg = JSON.parse(await readFile(candidate, 'utf8'));
      if (pkg.packageManager) {
        return pkg.packageManager;
      }
    } catch {
      // Keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return 'unknown';
}

async function runJob({ inputRoot, job, minFreeBytes, outputRoot }) {
  const startedAt = Date.now();
  const deadlineMs = startedAt + JOB_TIMEOUT_MS;
  // Sampled parent RSS at checkpoints only: expensive Sharp work runs in
  // worker children whose memory is excluded, and peaks between samples are
  // missed. This is not the encoder/job peak and must not size capacity.
  const startedRss = process.memoryUsage().rss;
  let sampledParentRss = startedRss;
  const sampleRss = () => {
    sampledParentRss = Math.max(sampledParentRss, process.memoryUsage().rss);
  };
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
    assertJobDeadline(deadlineMs, 'pre-commit');
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
    return {
      assetId: job.assetId,
      durability: committed.durability,
      elapsedMs: Date.now() - startedAt,
      generationId,
      merchantId: job.merchantId,
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
    return {
      assetId: job.assetId,
      code: error?.code ?? 'unknown',
      elapsedMs: Date.now() - startedAt,
      merchantId: job.merchantId,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      sampledParentRssBytes: sampledParentRss,
      role: job.role,
      status: 'failed',
    };
  }
}

export async function runPilotGeneration({
  inputRoot,
  inventoryPath,
  minFreeBytes,
  outputRoot,
}) {
  const floor = parseMinFreeBytes(minFreeBytes) ?? MIN_FREE_BYTES;
  const jobs = await readInventoryJobs(inventoryPath).catch((error) => {
    throw new PilotGenerateError('inventory-invalid', error.message);
  });
  await mkdir(join(outputRoot, 'generations'), { recursive: true });
  await mkdir(join(outputRoot, 'reports'), { recursive: true });
  const results = [];
  for (const job of jobs) {
    results.push(await runJob({ inputRoot, job, minFreeBytes: floor, outputRoot }));
  }
  const ok = results.filter((result) => result.status === 'ok').length;
  const reused = results.filter((result) => result.reused).length;
  const failed = results.length - ok;
  const report = {
    createdAt: new Date().toISOString(),
    encoderOptions: ENCODER_OPTIONS,
    jobs: results,
    qualityLadder: QUALITY_LADDER,
    recipe: JSON.parse(RECIPE_CANONICAL_JSON),
    recipeId: RECIPE_ID,
    summary: { failed, ok, reused, total: results.length },
    versions: {
      libvips: sharp.versions.vips,
      node: process.version,
      packageManager: await findPnpmPin(),
      sharp: sharp.versions.sharp,
      sharpCodecs: sharp.versions,
    },
  };
  const reportName = `${report.createdAt.replace(/[:.]/g, '-')}-${createRunToken()}.json`;
  await writeFile(join(outputRoot, 'reports', reportName), `${JSON.stringify(report, null, 2)}\n`);
  return { failed, ok, reused, total: results.length };
}

export function parseMinFreeBytes(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    throw new PilotGenerateError(
      'bad-args',
      'min-free-bytes must be a non-negative integer'
    );
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new PilotGenerateError(
      'bad-args',
      'min-free-bytes must be a non-negative integer'
    );
  }
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = parseCliArgs(process.argv.slice(2), ['inventory', 'input-root', 'output-root']);
    const summary = await runPilotGeneration({
      inputRoot: args['input-root'],
      inventoryPath: args.inventory,
      minFreeBytes: parseMinFreeBytes(args['min-free-bytes']),
      outputRoot: args['output-root'],
    });
    console.log(JSON.stringify(summary));
    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  })().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
