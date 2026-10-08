import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type {
  PilotInventoryBinding,
  PilotManifest,
} from '@/schemas/merchant-image-variant-pilot';
import { readUpToBytes } from './lab-config-stage-io';
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
  const seen = new Set<string>();
  for (const tier of manifest.tiers) {
    if (seen.has(tier.path)) {
      continue;
    }
    seen.add(tier.path);
    let bytes: Buffer;
    try {
      const read = await readUpToBytes(
        join(outputRoot, 'generations', generationId, tier.path),
        tier.bytes
      );
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
