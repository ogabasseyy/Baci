import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateArtifacts } from './sitespeed-artifacts.mjs';
import { assertServedBuild } from './sitespeed-build-identity.mjs';
import { parseArgs } from './sitespeed-cli-options.mjs';
import { validateMatrix } from './sitespeed-matrix.mjs';
import {
  prepareSampleDirectory,
  runKey,
  saveManifest,
} from './sitespeed-run-output.mjs';
import { gitMetadata } from './sitespeed-source-metadata.mjs';

export { validateArtifacts } from './sitespeed-artifacts.mjs';
export { runKey } from './sitespeed-run-output.mjs';

const execFileAsync = promisify(execFile);
export const SITESPEED_IMAGE =
  'sitespeedio/sitespeed.io:42.7.0@sha256:3b89ded94e75faf09d34a9f0921d621d470564dcee7c7f51bf2297d701451f71';
export const DEFAULT_BASE_URL =
  process.env.PERF_BASE_URL || 'http://host.docker.internal:3105';
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MATRIX = join(
  moduleDirectory,
  'storefront-route-matrix.json'
);

export function loadMatrix(file = DEFAULT_MATRIX) {
  return validateMatrix(JSON.parse(readFileSync(file, 'utf8')));
}

export function selectRuns(
  matrix,
  { profiles = matrix.profiles, families } = {}
) {
  const unknownFamilies =
    families?.filter(
      (family) => !matrix.routes.some((route) => route.family === family)
    ) ?? [];
  const unknownProfiles = profiles.filter(
    (profile) => !matrix.profiles.includes(profile)
  );
  if (unknownFamilies.length || unknownProfiles.length)
    throw new Error(
      `unknown selection: ${[...unknownFamilies, ...unknownProfiles].join(', ')}`
    );
  const wanted = families?.length ? new Set(families) : null;
  const routes = matrix.routes.filter(
    (route) => !wanted || wanted.has(route.family)
  );
  if (!routes.length) throw new Error('route selection is empty');
  const selectedProfiles = profiles.filter((profile) =>
    matrix.profiles.includes(profile)
  );
  if (!selectedProfiles.length) throw new Error('profile selection is empty');
  return selectedProfiles.flatMap((profile) =>
    routes.flatMap((route) =>
      Array.from({ length: matrix.coldRuns }, (_, sample) => ({
        profile,
        ...route,
        sample: sample + 1,
      }))
    )
  );
}

function bytesFree(path) {
  const fs = statfsSync(path);
  return Number(fs.bavail) * Number(fs.bsize);
}

export function diskPreflight(path, { reserveGiB = 10, stopGiB = 5 } = {}) {
  mkdirSync(path, { recursive: true });
  const freeBytes = bytesFree(path);
  const reserveBytes = reserveGiB * 1024 ** 3;
  const stopBytes = stopGiB * 1024 ** 3;
  return {
    freeBytes,
    reserveBytes,
    stopBytes,
    ok: freeBytes >= reserveBytes,
    stop: freeBytes < stopBytes,
  };
}

export function dockerArgs(run, outputFolder, baseUrl = DEFAULT_BASE_URL) {
  const profileArgs = run.profile === 'mobile' ? ['--mobile'] : [];
  return [
    'run',
    '--rm',
    '--shm-size=2g',
    '-v',
    `${resolve(outputFolder)}:/sitespeed.io`,
    SITESPEED_IMAGE,
    new URL(run.path, baseUrl).href,
    '-b',
    'chrome',
    '-n',
    '1',
    ...profileArgs,
    '--video',
    '--visualMetrics',
    '--browsertime.chrome.collectConsoleLog',
    '--outputFolder',
    `/sitespeed.io/${run.output ? relative(resolve(outputFolder), run.output) : `${run.profile}/${run.family}/sample-${run.sample}`}`,
  ];
}

export async function runMatrix({
  matrixFile = DEFAULT_MATRIX,
  outputFolder = 'output/sitespeed-matrix',
  baseUrl = DEFAULT_BASE_URL,
  profiles,
  families,
  dryRun = false,
  maxRuns = Number.POSITIVE_INFINITY,
  cwd = process.cwd(),
  timeoutMs = 180_000,
  minFreeGiB = 10,
  buildId,
  samples,
  spawn = execFileAsync,
} = {}) {
  if (!Number.isFinite(minFreeGiB) || minFreeGiB < 5)
    throw new Error('min-free-gib must be a finite number of at least 5');
  if (
    maxRuns !== Number.POSITIVE_INFINITY &&
    (!Number.isFinite(maxRuns) || maxRuns < 1 || !Number.isInteger(maxRuns))
  )
    throw new Error('max-runs must be a positive integer');
  if (
    samples !== undefined &&
    (!Number.isFinite(samples) || samples < 1 || !Number.isInteger(samples))
  )
    throw new Error('samples must be a positive integer');
  const matrix = loadMatrix(matrixFile);
  if (samples !== undefined) matrix.coldRuns = Math.max(1, Math.floor(samples));
  if (!dryRun && !buildId)
    throw new Error(
      '--build-id is required for a real run (served build identity)'
    );
  const runs = selectRuns(matrix, { profiles, families });
  if (!runs.length) throw new Error('no measurements selected');
  if (!dryRun) {
    const preflight = new URL(baseUrl);
    // The macOS runner reaches the same host proxy through loopback; only
    // the browser inside Docker needs Docker Desktop's host DNS alias.
    if (preflight.hostname === 'host.docker.internal')
      preflight.hostname = '127.0.0.1';
    await assertServedBuild(preflight.toString(), buildId);
  }
  const output = resolve(cwd, outputFolder);
  const manifestFile = join(output, 'run-manifest.json');
  const matrixSha256 = createHash('sha256')
    .update(readFileSync(matrixFile))
    .digest('hex');
  const metadata = await gitMetadata(cwd);
  const manifest =
    !dryRun && existsSync(manifestFile)
      ? JSON.parse(readFileSync(manifestFile, 'utf8'))
      : {
          schemaVersion: 1,
          image: SITESPEED_IMAGE,
          sitespeedVersion: '42.7.0',
          baseUrl,
          profileMode: 'native (no mobile throttling)',
          minFreeGiB,
          buildId,
          matrixSha256,
          runs: {},
          metadata,
        };
  for (const [key, value] of [
    ['image', SITESPEED_IMAGE],
    ['baseUrl', baseUrl],
    ['matrixSha256', matrixSha256],
    ['sha', metadata.sha],
    ['dirty', metadata.dirty],
    ['diffHash', metadata.diffHash],
    ['buildId', buildId],
  ]) {
    const actual =
      key === 'sha' || key === 'dirty' || key === 'diffHash'
        ? manifest.metadata?.[key]
        : manifest[key];
    if (actual !== value && Object.keys(manifest.runs || {}).length)
      throw new Error(`resume configuration mismatch: ${key}`);
  }
  const planned = runs.map((run) => ({
    ...run,
    key: runKey(run),
    output: join(output, run.profile, run.family, `sample-${run.sample}`),
  }));
  if (dryRun) return { manifest, runs: planned, dryRun: true };
  mkdirSync(output, { recursive: true });
  const disk = diskPreflight(output);
  if (disk.freeBytes < minFreeGiB * 1024 ** 3)
    throw new Error(
      `insufficient free disk: ${(disk.freeBytes / 1024 ** 3).toFixed(2)} GiB; need ${minFreeGiB} GiB`
    );
  delete manifest.stopReason;
  saveManifest(manifestFile, manifest);
  let completed = 0;
  for (const run of planned) {
    const expectedUrl = new URL(run.path, baseUrl).href;
    if (completed >= maxRuns) break;
    if (manifest.runs[run.key]?.status === 'complete') {
      try {
        validateArtifacts(manifest.runs[run.key].output, { expectedUrl });
        continue;
      } catch {
        manifest.runs[run.key].status = 'pending';
      }
    }
    const current = diskPreflight(output);
    if (
      current.freeBytes < 5 * 1024 ** 3 ||
      current.freeBytes < minFreeGiB * 1024 ** 3
    ) {
      manifest.stopReason = `free disk below ${minFreeGiB} GiB threshold (hard floor 5 GiB)`;
      saveManifest(manifestFile, manifest);
      break;
    }
    run.output = prepareSampleDirectory(output, run);
    manifest.runs[run.key] = {
      ...run,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    saveManifest(manifestFile, manifest);
    try {
      const execution = await spawn(
        'docker',
        dockerArgs(run, output, baseUrl),
        {
          cwd,
          timeout: timeoutMs,
        }
      );
      if (typeof execution?.stdout === 'string')
        writeFileSync(join(run.output, 'runner.stdout.log'), execution.stdout);
      manifest.runs[run.key] = {
        ...manifest.runs[run.key],
        status: 'complete',
        completedAt: new Date().toISOString(),
        artifacts: validateArtifacts(run.output, { expectedUrl }),
        stdoutTail:
          typeof execution?.stdout === 'string'
            ? execution.stdout.slice(-4000)
            : undefined,
      };
    } catch (error) {
      manifest.runs[run.key] = {
        ...manifest.runs[run.key],
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      saveManifest(manifestFile, manifest);
      throw error;
    }
    saveManifest(manifestFile, manifest);
    completed += 1;
  }
  return { manifest, runs: planned, completed, dryRun: false };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  runMatrix(parseArgs(process.argv.slice(2)))
    .then((result) =>
      console.log(
        JSON.stringify(
          {
            dryRun: result.dryRun,
            planned: result.runs.length,
            completed: result.completed ?? 0,
          },
          null,
          2
        )
      )
    )
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
