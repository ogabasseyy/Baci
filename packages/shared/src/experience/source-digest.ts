import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ExperienceManifest } from './types';
/** Hash schema-normalized manifests; only source-file listing order is ignored.
 * Upload writers and build verifiers use the same schema field ordering.
 * Changing serialization requires versioning existing source/ticket identities.
 */
export function sourceDigest(manifest: ExperienceManifest): string {
  const canonical = {
    ...manifest,
    files: [...manifest.files].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    ),
  };
  return bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify(canonical)))
  );
}
