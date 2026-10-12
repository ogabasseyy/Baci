// Pre-publication verification for the merchant image pilot manifest
// store: fsync, owned-directory confinement, and tier byte identity.
// Split from manifest-store.mjs under the repo line ceiling.
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { readUpToBytes } from './disk-guards.mjs';
import { PilotManifestError } from './manifest.mjs';

export async function defaultFsync(path) {
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
export async function assertOwnedDir(dir, expectedReal, label) {
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
export async function assertTierBytes(tiers, resolve, stage) {
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
