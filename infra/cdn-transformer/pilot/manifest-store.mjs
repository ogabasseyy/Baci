// Durable generation storage for the merchant image pilot: atomic
// fsync-then-rename commits plus reuse. Verified loads live in
// manifest-store-load.mjs (re-exported here); schemas, identity, and
// parsing stay in manifest.mjs.
import { createHash, randomUUID } from 'node:crypto';
import {
  rename as fsRename,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  isUnsupportedSyncError,
  readUpToBytes,
  removeOwnedStaging,
} from './disk-guards.mjs';
import { generationIdFor } from './generation-identity.mjs';
import { PilotManifestError, parsePilotManifest } from './manifest.mjs';
import { generationDir, loadGeneration } from './manifest-store-load.mjs';
import { tryReuseGeneration } from './manifest-store-reuse.mjs';

export { loadGeneration };

async function defaultFsync(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// Owned-directory verification, mirroring prepareOwnedStaging: the path
// must be a real directory resolving exactly to its expected location.
// A planted symlink here would sail through recursive creation and push
// the commit renames (or the published generation) outside the tree.
async function assertOwnedDir(dir, expectedReal, label) {
  const info = await lstat(dir);
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(dir)) !== expectedReal
  ) {
    throw new PilotManifestError(
      `unsafe-${label}-directory`,
      `${label} must be a confined directory, not a symlink`
    );
  }
}

// Tier byte verification against the validated manifest, resolved
// through an injected path map so both commit phases share it: the
// staged paths before the move, and the commitDir paths immediately
// before the visibility rename. A staged tier replaced after the first
// check would otherwise publish unverified bytes — the rename and the
// fsyncs verify nothing themselves.
async function assertTierBytes(tiers, resolve, stage) {
  const uniquePaths = [...new Set(tiers.map((tier) => tier.path))];
  for (const name of uniquePaths) {
    const from = resolve(name);
    if (!from) {
      throw new PilotManifestError(
        'staged-file-mismatch',
        `missing staged file: ${name}`
      );
    }
    const tier = tiers.find((entry) => entry.path === name);
    // Bounded by the manifest claim + 1: a corrupted staged tier
    // replaced with a huge file rejects on truncation instead of
    // exhausting the generator ahead of the length comparison. The
    // claim is schema-capped (MAX_INPUT_BYTES), so the +1 probe
    // cannot become an unbounded allocation.
    let staged;
    try {
      staged = await readUpToBytes(from, tier.bytes + 1);
    } catch {
      throw new PilotManifestError(
        stage === 'commit' ? 'commit-bytes-mismatch' : 'staged-file-mismatch',
        `cannot read ${stage} file: ${name}`
      );
    }
    if (
      staged.truncated ||
      staged.bytes.length !== tier.bytes ||
      createHash('sha256').update(staged.bytes).digest('hex') !== tier.sha256
    ) {
      throw new PilotManifestError(
        stage === 'commit' ? 'commit-bytes-mismatch' : 'staged-file-mismatch',
        stage === 'commit'
          ? `commit bytes differ: ${name}`
          : `staged bytes differ: ${name}`
      );
    }
  }
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
  const removeDir = deps.rm ?? rm;
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
  await assertTierBytes(
    valid.tiers,
    (name) => stagedByName.get(name),
    'staged'
  );
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
    return tryReuseGeneration({
      dir,
      generationId,
      job,
      outputRoot,
      removeStaging,
      stagingDir,
      valid,
    });
  }
  const commitDir = join(stagingDir, 'commit');
  // Exclusive create: a pre-planted symlink must fail here instead of
  // being followed by the renames below. EEXIST (a crash-recovery rerun
  // finding its own directory) is verified, not trusted.
  try {
    await (deps.mkdir ?? mkdir)(commitDir);
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
  }
  const realStaging = await realpath(stagingDir);
  await assertOwnedDir(commitDir, join(realStaging, 'commit'), 'commit');
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
  const generationsDir = join(outputRoot, 'generations');
  await (deps.mkdir ?? mkdir)(generationsDir, { recursive: true });
  // Re-verify both directories immediately before the visibility rename:
  // either could have been swapped for a symlink after creation, and the
  // rename would then publish outside the output root (or publish the
  // symlink itself as the generation).
  const realRoot = await realpath(outputRoot);
  await assertOwnedDir(
    generationsDir,
    join(realRoot, 'generations'),
    'generations'
  );
  await assertOwnedDir(commitDir, join(realStaging, 'commit'), 'commit');
  // Re-verify every tier inside commitDir immediately before the
  // visibility rename: a staged file replaced after the pre-move check
  // would otherwise publish bytes the manifest never certified.
  await assertTierBytes(
    valid.tiers,
    (name) => join(commitDir, name),
    'commit'
  );
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
      const removal = await removeDir(dir, {
        force: true,
        recursive: true,
      }).catch((rmError) => rmError);
      if (removal === undefined) {
        throw new PilotManifestError(
          'sync-failed',
          `post-commit directory fsync failed (${error?.code ?? 'unknown'}); unpublished`
        );
      }
      // Removal failed too: the rejected generation is still visible,
      // so move it out of the generations namespace — reuse resolves
      // by id and must never validate output the publishing run
      // rejected. The quarantine rename needs parent-write only, so it
      // succeeds exactly when a read-only directory defeats rm.
      const quarantine = join(
        outputRoot,
        `.quarantined-${generationId}-${randomUUID()}`
      );
      try {
        await rename(dir, quarantine);
      } catch (quarantineError) {
        throw new PilotManifestError(
          'sync-failed',
          `post-commit directory fsync failed (${error?.code ?? 'unknown'}); ` +
            `removal failed (${removal?.code ?? 'unknown'}) and quarantine failed ` +
            `(${quarantineError?.code ?? 'unknown'}); generation left visible at ` +
            `${dir} — remove it before retrying`
        );
      }
      throw new PilotManifestError(
        'sync-failed',
        `post-commit directory fsync failed (${error?.code ?? 'unknown'}); ` +
          `removal failed (${removal?.code ?? 'unknown'}) — quarantined at ` +
          `${quarantine}; remove it before retrying`
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
