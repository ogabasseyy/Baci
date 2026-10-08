import { readFile, mkdir, writeFile, lstat, realpath } from 'node:fs/promises';
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
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(path) !== path) {
      throw new PilotGenerateError('unsafe-output-directory', `${child} must be a confined directory, not a symlink`);
    }
  }
  // Cross-process encode serialization: the worker pool only serializes
  // within this process, so the run holds the output-root-wide encoder
  // lock for its whole duration. A contender on the same root fails
  // fast instead of encoding concurrently.
  const encoderLock = await acquireEncoderLock(outputRoot);
  const results = [];
  try {
    for (const job of jobs) {
      results.push(await runJob({ inputRoot, job, minFreeBytes: floor, outputRoot }));
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
