import { readFile, mkdir, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  ENCODER_OPTIONS,
  MIN_FREE_BYTES,
  QUALITY_LADDER,
  RECIPE_CANONICAL_JSON,
  RECIPE_ID,
} from './constants.mjs';
import { createRunToken } from './claims.mjs';
import { parseCliArgs } from './cli-args.mjs';
import {
  isUnsupportedSyncError,
  writeConfinedFile,
} from './disk-guards.mjs';
import { acquireEncoderLock } from './encoder-lock.mjs';
import { readInventoryJobs } from './job-schema.mjs';
import { PilotGenerateError, runJob } from './generate-job.mjs';

const here = dirname(fileURLToPath(import.meta.url));

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


// A confined output child is a real directory whose canonical path is
// exactly the joined path: any symlink in the chain (or a non-directory
// squat) resolves elsewhere and refuses. Checked at setup; the report
// publish binds the reports directory through a held descriptor instead
// of re-checking the pathname, so a mid-run swap refuses at publication
// rather than redirecting bytes outside the output root.
export async function assertConfinedChild(outputRoot, child) {
  const path = join(outputRoot, child);
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(path)) !== path
  ) {
    throw new PilotGenerateError(
      'unsafe-output-directory',
      `${child} must be a confined directory, not a symlink`
    );
  }
}

export async function runPilotGeneration({
  hooks = {},
  inputRoot,
  inventoryPath,
  locksDir,
  minFreeBytes,
  outputRoot,
}) {
  // Trust boundary: the inventory is trusted operator input. Record
  // URLs are fetched from the operator workstation with only IP-literal
  // SSRF guards (see fetch-policy.mjs) — plain hostnames resolve
  // unchecked and DNS rebinding is out of scope. Never feed a
  // merchant/CDN export here without reviewing every URL first.
  const floor = parseMinFreeBytes(minFreeBytes) ?? MIN_FREE_BYTES;
  const jobs = await readInventoryJobs(inventoryPath).catch((error) => {
    throw new PilotGenerateError('inventory-invalid', error.message);
  });
  // An empty inventory must never report green: zero jobs would summarize
  // as failed:0/ok:0 and exit 0 with no generation artifacts.
  if (jobs.length === 0) {
    throw new PilotGenerateError(
      'inventory-empty',
      'inventory contains no jobs; refusing to report an empty generation as success'
    );
  }
  await mkdir(outputRoot, { recursive: true });
  outputRoot = await realpath(outputRoot);
  for (const child of ['claims', 'generations', 'reports']) {
    const path = join(outputRoot, child);
    await mkdir(path, { recursive: true });
    await assertConfinedChild(outputRoot, child);
  }
  // Cross-process encode serialization: the worker pool only serializes
  // within this process, so the run holds the host-wide encoder lock
  // for its whole duration — across all output roots, not just this
  // one. A contender fails fast instead of encoding concurrently.
  // locksDir isolates test runs so parallel suites never contend.
  const encoderLock = await acquireEncoderLock(outputRoot, { locksDir });
  const results = [];
  try {
    for (const job of jobs) {
      results.push(
        await runJob({
          encoderLock,
          inputRoot,
          job,
          minFreeBytes: floor,
          outputRoot,
        })
      );
    }
  } finally {
    await encoderLock.release();
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
  // Confined publication through a held descriptor: the setup check
  // ran a whole generation ago, and a pathname write would let a
  // swapped-in symlink redirect the bytes outside the output root. The
  // hook lets tests win that race deterministically — the write still
  // refuses, because the binding happens inside the write itself.
  await hooks.beforeReportWrite?.();
  const writeReport = hooks.writeReportFile ?? writeConfinedFile;
  const serializeReport = () => `${JSON.stringify(report, null, 2)}\n`;
  try {
    await writeReport(join(outputRoot, 'reports'), reportName, serializeReport());
  } catch (error) {
    if (!isUnsupportedSyncError(error)) {
      throw error;
    }
    // Degraded durability, same as generation commits: the jobs already
    // published, so record the marked summary unsynced rather than
    // exiting nonzero with no report at all. The failed attempt left
    // bytes behind; remove them so the exclusive retry owns the name.
    report.durability = 'sync-unsupported';
    await unlink(join(outputRoot, 'reports', reportName)).catch(() => undefined);
    await writeReport(join(outputRoot, 'reports'), reportName, serializeReport(), {
      sync: false,
    });
  }
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
  // The 2 GiB floor is mandatory, not a default: a CLI override below it
  // would disable both the initial and pre-publication safety checks.
  // Lower values stay confined to injected test dependencies (runJob).
  if (parsed < MIN_FREE_BYTES) {
    throw new PilotGenerateError(
      'bad-args',
      `min-free-bytes must be at least ${MIN_FREE_BYTES}`
    );
  }
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  (async () => {
    const args = parseCliArgs(
      process.argv.slice(2),
      ['inventory', 'input-root', 'output-root'],
      ['inventory', 'input-root', 'output-root', 'min-free-bytes']
    );
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
