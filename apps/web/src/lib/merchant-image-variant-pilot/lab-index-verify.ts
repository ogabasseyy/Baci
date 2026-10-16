import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  PilotInventoryBinding,
  PilotManifest,
} from '@/schemas/merchant-image-variant-pilot';
import { readUpToBytes } from './lab-config-stage-io-read';
import { resolveLabGenerationDir } from './lab-generation-dir';
import { labGenerationIdFor } from './lab-generation-identity';

// Re-reads every tier file the manifest names and compares size and hash:
// generation bytes must still match the manifest at index-build time.
// Reads are bounded by the claimed size plus one byte: a corrupted tier
// concatenated into a huge file fails closed instead of exhausting the
// startup process.
export async function verifyOutputHashes(
  outputRoot: string,
  generationId: string,
  manifest: PilotManifest
): Promise<string | null> {
  // Re-confine at tier-read time: the manifest read above passed its own
  // confinement, but the entry must still be inside the output tree when
  // its bytes are verified.
  try {
    await resolveLabGenerationDir(outputRoot, generationId);
  } catch {
    return 'generation entry escapes the output root';
  }
  const seen = new Set<string>();
  for (const tier of manifest.tiers) {
    if (seen.has(tier.path)) {
      continue;
    }
    seen.add(tier.path);
    let bytes: Buffer;
    try {
      // A FIFO, socket, or device in place of a published tier would
      // block the bounded reader in open()/read() (the byte ceiling
      // bounds reads, not waits), hanging lab startup past any
      // deadline instead of reporting a hash mismatch. Only regular
      // files verify; links and special files fail like a mismatch.
      const tierPath = join(outputRoot, 'generations', generationId, tier.path);
      const entry = await lstat(tierPath).catch(() => null);
      if (entry && (entry.isSymbolicLink() || !entry.isFile())) {
        return `output is not a regular file: ${tier.path}`;
      }
      const read = await readUpToBytes(tierPath, tier.bytes);
      if (read.truncated) {
        return `byte size changed: ${tier.path}`;
      }
      bytes = read.bytes;
    } catch {
      return `output missing: ${tier.path}`;
    }
    if (bytes.length !== tier.bytes) {
      return `byte size changed: ${tier.path}`;
    }
    if (createHash('sha256').update(bytes).digest('hex') !== tier.sha256) {
      return `output hash mismatch: ${tier.path}`;
    }
  }
  return null;
}

// Recomputes the generation id from the job, recipe, encoder, and source:
// a copied or renamed generation directory served under a different id
// must not activate, even when every hash inside still verifies.
export function verifyGenerationBinding(input: {
  binding: PilotInventoryBinding;
  generationId: string;
  manifest: PilotManifest;
}): string | null {
  const expected = labGenerationIdFor({
    assetId: input.binding.assetId,
    encoderIdentity: input.manifest.encoder,
    merchantId: input.binding.merchantId,
    recipeId: input.manifest.recipeId,
    role: input.binding.role,
    sourceSha256: input.manifest.source.sha256,
  });
  if (expected !== input.generationId) {
    return 'generation directory is not the recipe output for this binding';
  }
  return null;
}
