// Durable generation storage for the merchant image pilot: verified
// loads and atomic fsync-then-rename commits. Schemas, identity, and
// parsing stay in manifest.mjs.
import { createHash } from 'node:crypto';
import {
  rename as fsRename,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { readUpToBytes, removeOwnedStaging } from './disk-guards.mjs';
import { generationIdFor } from './generation-identity.mjs';
import { PilotManifestError, parsePilotManifest } from './manifest.mjs';

async function defaultFsync(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// fsync failure classification: only "operation not supported" signals
// downgrade the durability label. Anything else (ENOSPC, EIO, ...) means
// the bytes may never have reached stable storage and must abort rather
// than publish a potentially non-durable or corrupted result.
function isUnsupportedSyncError(error) {
  return error?.code === 'ENOSYS' || error?.code === 'EINVAL';
}

function generationDir(outputRoot, generationId) {
  if (!/^[0-9a-f]{64}$/.test(generationId)) {
    throw new PilotManifestError('bad-request', 'unsafe generation id');
  }
  return join(outputRoot, 'generations', generationId);
}

export async function loadGeneration(outputRoot, generationId) {
  const dir = generationDir(outputRoot, generationId);
  // A symlinked generation entry is never reusable: lstat succeeds on
  // links, but only a real directory whose canonical path stays beneath
  // generations/ may serve reuse, quality-sheet, or staging reads.
  const stat = await lstat(dir).catch(() => {
    throw new PilotManifestError(
      'generation-missing',
      'generation is not published'
    );
  });
  if (!stat.isDirectory()) {
    throw new PilotManifestError(
      'generation-corrupt',
      'generation entry is not a directory'
    );
  }
  const generationsRoot = join(outputRoot, 'generations');
  const realRoot = await realpath(generationsRoot).catch(() => {
    throw new PilotManifestError(
      'generation-missing',
      'generation is not published'
    );
  });
  if ((await realpath(dir)) !== join(realRoot, generationId)) {
    throw new PilotManifestError(
      'generation-corrupt',
      'generation entry escapes the output root'
    );
  }
  const text = await readFile(join(dir, 'manifest.json'), 'utf8').catch(() => {
    throw new PilotManifestError(
      'generation-missing',
      'generation is not published'
    );
  });
  let parsed;
  try {
    parsed = parsePilotManifest(JSON.parse(text));
  } catch {
    throw new PilotManifestError(
      'generation-corrupt',
      'manifest is not valid JSON'
    );
  }
  if (!parsed.ok) {
    throw new PilotManifestError(
      'generation-corrupt',
      `manifest invalid (${parsed.issues.join('; ')})`
    );
  }
  const files = new Map();
  for (const tier of parsed.manifest.tiers) {
    if (files.has(tier.path)) {
      continue;
    }
    // Bounded by the claimed size: a corrupted tier replaced with a huge
    // file rejects on size without allocating the whole file.
    let bytes;
    try {
      const read = await readUpToBytes(join(dir, tier.path), tier.bytes);
      if (read.truncated) {
        throw new PilotManifestError(
          'generation-corrupt',
          `byte size changed: ${tier.path}`
        );
      }
      bytes = read.bytes;
    } catch (error) {
      if (error instanceof PilotManifestError) {
        throw error;
      }
      throw new PilotManifestError(
        'generation-corrupt',
        `output missing: ${tier.path}`
      );
    }
    if (bytes.length !== tier.bytes) {
      throw new PilotManifestError(
        'generation-corrupt',
        `byte size changed: ${tier.path}`
      );
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== tier.sha256) {
      throw new PilotManifestError(
        'generation-corrupt',
        `output hash mismatch: ${tier.path}`
      );
    }
    // Keep the validated buffers so consumers embed them without a reread
    // (a reread can race replacement bytes under a valid hash).
    files.set(tier.path, bytes);
  }
  return { dir, files, manifest: parsed.manifest };
}

export async function commitGeneration({
  deps = {},
  files,
  generationId,
  job,
  manifest,
  outputRoot,
  stagingDir,
}) {
  const rename = deps.rename ?? fsRename;
  const fsyncFile = deps.fsyncFile ?? defaultFsync;
  const fsyncDir = deps.fsyncDir ?? defaultFsync;
  const assertDeadline = deps.assertDeadline ?? (() => undefined);
  const removeStaging = deps.removeOwnedStaging ?? removeOwnedStaging;
  const parsed = parsePilotManifest(manifest);
  if (!parsed.ok) {
    throw new PilotManifestError('manifest-invalid', parsed.issues.join('; '));
  }
  const valid = parsed.manifest;
  if (
    valid.merchantId !== job.merchantId ||
    valid.assetId !== job.assetId ||
    valid.role !== job.role ||
    valid.source.sha256 !== job.expectedSha256
  ) {
    throw new PilotManifestError(
      'manifest-mismatch',
      'manifest does not match the validated job'
    );
  }
  // Every manifest tier needs a staged file with identical bytes.
  const stagedByName = new Map(files.map((file) => [file.name, file.from]));
  const uniquePaths = [...new Set(valid.tiers.map((tier) => tier.path))];
  for (const name of uniquePaths) {
    const from = stagedByName.get(name);
    if (!from) {
      throw new PilotManifestError(
        'staged-file-mismatch',
        `missing staged file: ${name}`
      );
    }
    const tier = valid.tiers.find((entry) => entry.path === name);
    const bytes = await readFile(from).catch(() => {
      throw new PilotManifestError(
        'staged-file-mismatch',
        `cannot read staged file: ${name}`
      );
    });
    if (
      bytes.length !== tier.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== tier.sha256
    ) {
      throw new PilotManifestError(
        'staged-file-mismatch',
        `staged bytes differ: ${name}`
      );
    }
  }
  const expectedId = generationIdFor({
    encoderIdentity: valid.encoder,
    job,
    recipeId: valid.recipeId,
    sourceSha256: job.expectedSha256,
  });
  if (expectedId !== generationId) {
    throw new PilotManifestError(
      'generation-misbound',
      'generation id does not match the requested identity'
    );
  }
  const dir = generationDir(outputRoot, generationId);
  const exists = await lstat(dir)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    // Never overwrite: reuse only after full validation AND a complete
    // identity comparison with the requested generation.
    const loaded = await loadGeneration(outputRoot, generationId);
    const sameEncoder =
      loaded.manifest.encoder.name === valid.encoder.name &&
      loaded.manifest.encoder.sharpVersion === valid.encoder.sharpVersion &&
      loaded.manifest.encoder.libvipsVersion === valid.encoder.libvipsVersion;
    if (
      loaded.manifest.merchantId !== valid.merchantId ||
      loaded.manifest.assetId !== valid.assetId ||
      loaded.manifest.role !== valid.role ||
      loaded.manifest.source.sha256 !== valid.source.sha256 ||
      loaded.manifest.recipeId !== valid.recipeId ||
      !sameEncoder
    ) {
      throw new PilotManifestError(
        'generation-misbound',
        'existing generation identity does not match the requested generation'
      );
    }
    // A failed reuse-path removal must surface: the caller skips its own
    // removal for reused generations, so a swallowed error would strand a
    // complete staging directory on every reuse until the disk floor stops
    // the pipeline. Returned (not thrown): the generation is published and
    // reusable, so the caller records a warning and retries cleanup.
    let stagingCleanupError = null;
    try {
      await removeStaging(outputRoot, stagingDir);
    } catch (error) {
      stagingCleanupError =
        `reuse-path staging cleanup failed (${error?.code ?? 'unknown'}): ` +
        `${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          200
        ) +
        `; generation ${generationId} is published and reusable`;
    }
    // Reuse reports the publish-time verdict, never an assumed 'synced':
    // a generation published where fsync is unsupported must not gain
    // power-loss durability by being read later.
    return {
      durability: await readPersistedDurability(dir),
      path: dir,
      reused: true,
      ...(stagingCleanupError ? { stagingCleanupError } : {}),
    };
  }
  const commitDir = join(stagingDir, 'commit');
  await (deps.mkdir ?? mkdir)(commitDir, { recursive: true });
  for (const name of uniquePaths) {
    await rename(stagedByName.get(name), join(commitDir, name));
  }
  await writeFile(
    join(commitDir, 'manifest.json'),
    `${JSON.stringify(valid, null, 2)}\n`
  );
  let durability = 'synced';
  try {
    for (const name of [...uniquePaths, 'manifest.json']) {
      await fsyncFile(join(commitDir, name));
    }
    await fsyncDir(commitDir);
  } catch (error) {
    if (!isUnsupportedSyncError(error)) {
      throw new PilotManifestError(
        'sync-failed',
        `pre-commit fsync failed (${error?.code ?? 'unknown'}); refusing to publish`
      );
    }
    // Atomic visibility still holds via rename; power-loss durability is
    // honestly reported instead of claimed on this filesystem.
    durability = 'sync-unsupported';
  }
  await (deps.mkdir ?? mkdir)(join(outputRoot, 'generations'), {
    recursive: true,
  });
  // Recheck the job deadline immediately before the visibility rename:
  // verification and the fsync loop above can consume the remaining
  // budget, and publishing an overdue generation (then reporting the job
  // failed) would leave reusable output the gate never approved.
  assertDeadline();
  await rename(commitDir, dir);
  try {
    await fsyncDir(join(outputRoot, 'generations'));
  } catch (error) {
    if (!isUnsupportedSyncError(error)) {
      // The rename is visible but may not be durable: unpublish so the
      // failure leaves no reusable output, then report failed. A
      // concurrent reuse reader fails loudly (fail-closed) and retries.
      await rm(dir, { force: true, recursive: true }).catch(() => undefined);
      throw new PilotManifestError(
        'sync-failed',
        `post-commit directory fsync failed (${error?.code ?? 'unknown'}); unpublished`
      );
    }
    durability = 'sync-unsupported';
  }
  // Persist the publish-time verdict beside the manifest so reuse reports
  // what publish proved. Best-effort and post-visibility: the durability
  // value is only final after the renames above, and a lost sidecar must
  // degrade reuse reports to 'unknown' — never fail an already-published
  // job or print a false 'synced'.
  await writeFile(
    join(dir, 'durability.json'),
    JSON.stringify({ durability })
  ).catch(() => undefined);
  return { durability, path: dir, reused: false };
}

async function readPersistedDurability(dir) {
  try {
    const parsed = JSON.parse(
      await readFile(join(dir, 'durability.json'), 'utf8')
    );
    if (
      parsed?.durability === 'synced' ||
      parsed?.durability === 'sync-unsupported'
    ) {
      return parsed.durability;
    }
  } catch {
    // Missing or corrupt provenance (pre-sidecar generations, operator
    // deletion, torn write) fails honest: durability is unknown, not
    // 'synced'. This is advisory reporting only — reuse validation still
    // runs through loadGeneration plus the identity comparison above.
  }
  return 'unknown';
}
