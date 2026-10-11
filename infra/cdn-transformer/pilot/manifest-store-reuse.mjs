// Generation reuse for the merchant image pilot: an already-published
// generation is returned only after full validation AND a complete
// identity comparison with the requested generation — never overwritten.
// Split from manifest-store.mjs under the repo line ceiling.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PilotManifestError } from './manifest.mjs';
import { loadGeneration } from './manifest-store-load.mjs';

export async function tryReuseGeneration({
  dir,
  generationId,
  job,
  outputRoot,
  removeStaging,
  stagingDir,
  valid,
}) {
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
  // Byte-identity before reuse: the id pins sharp/libvips versions but
  // not codec builds or architecture, so a generation directory reused
  // or copied from another machine can hold different lossy bytes under
  // the same id. The job reports the freshly encoded tiers, so reusing
  // mismatched retained bytes would certify output the gate never saw.
  // Both manifests are zod-normalized, so the serialized ladders
  // compare canonically. Mismatch fails closed: clear the foreign
  // generation directory and re-run on one encoder build.
  if (JSON.stringify(loaded.manifest.tiers) !== JSON.stringify(valid.tiers)) {
    throw new PilotManifestError(
      'generation-misbound',
      'existing generation bytes differ from the requested generation'
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
