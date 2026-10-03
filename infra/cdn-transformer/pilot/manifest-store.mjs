// Durable generation storage for the merchant image pilot: verified
// loads and atomic fsync-then-rename commits. Schemas, identity, and
// parsing stay in manifest.mjs.
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename as fsRename,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { removeOwnedStaging } from './disk-guards.mjs';
import { generationIdFor } from './generation-identity.mjs';
import { parsePilotManifest, PilotManifestError } from './manifest.mjs';

async function defaultFsync(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function generationDir(outputRoot, generationId) {
  if (!/^[0-9a-f]{64}$/.test(generationId)) {
    throw new PilotManifestError('bad-request', 'unsafe generation id');
  }
  return join(outputRoot, 'generations', generationId);
}

export async function loadGeneration(outputRoot, generationId) {
  const dir = generationDir(outputRoot, generationId);
  const text = await readFile(join(dir, 'manifest.json'), 'utf8').catch(() => {
    throw new PilotManifestError('generation-missing', 'generation is not published');
  });
  let parsed;
  try {
    parsed = parsePilotManifest(JSON.parse(text));
  } catch {
    throw new PilotManifestError('generation-corrupt', 'manifest is not valid JSON');
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
    const bytes = await readFile(join(dir, tier.path)).catch(() => {
      throw new PilotManifestError('generation-corrupt', `output missing: ${tier.path}`);
    });
    if (bytes.length !== tier.bytes) {
      throw new PilotManifestError('generation-corrupt', `byte size changed: ${tier.path}`);
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== tier.sha256) {
      throw new PilotManifestError('generation-corrupt', `output hash mismatch: ${tier.path}`);
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
    throw new PilotManifestError('manifest-mismatch', 'manifest does not match the validated job');
  }
  // Every manifest tier needs a staged file with identical bytes.
  const stagedByName = new Map(files.map((file) => [file.name, file.from]));
  const uniquePaths = [...new Set(valid.tiers.map((tier) => tier.path))];
  for (const name of uniquePaths) {
    const from = stagedByName.get(name);
    if (!from) {
      throw new PilotManifestError('staged-file-mismatch', `missing staged file: ${name}`);
    }
    const tier = valid.tiers.find((entry) => entry.path === name);
    const bytes = await readFile(from).catch(() => {
      throw new PilotManifestError('staged-file-mismatch', `cannot read staged file: ${name}`);
    });
    if (
      bytes.length !== tier.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== tier.sha256
    ) {
      throw new PilotManifestError('staged-file-mismatch', `staged bytes differ: ${name}`);
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
    await removeOwnedStaging(outputRoot, stagingDir).catch(() => {});
    return { durability: 'synced', path: dir, reused: true };
  }
  const commitDir = join(stagingDir, 'commit');
  await (deps.mkdir ?? mkdir)(commitDir, { recursive: true });
  for (const name of uniquePaths) {
    await rename(stagedByName.get(name), join(commitDir, name));
  }
  await writeFile(join(commitDir, 'manifest.json'), `${JSON.stringify(valid, null, 2)}\n`);
  let durability = 'synced';
  try {
    for (const name of [...uniquePaths, 'manifest.json']) {
      await fsyncFile(join(commitDir, name));
    }
    await fsyncDir(commitDir);
  } catch {
    // Atomic visibility still holds via rename; power-loss durability is
    // honestly reported instead of claimed on this filesystem.
    durability = 'sync-unsupported';
  }
  await (deps.mkdir ?? mkdir)(join(outputRoot, 'generations'), { recursive: true });
  await rename(commitDir, dir);
  try {
    await fsyncDir(join(outputRoot, 'generations'));
  } catch {
    durability = 'sync-unsupported';
  }
  return { durability, path: dir, reused: false };
}
