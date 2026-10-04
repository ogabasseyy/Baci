import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PilotManifest } from '@/schemas/merchant-image-variant-pilot';

// Re-reads every tier file the manifest names and compares size and hash:
// generation bytes must still match the manifest at index-build time.
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
      bytes = await readFile(
        join(outputRoot, 'generations', generationId, tier.path)
      );
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
