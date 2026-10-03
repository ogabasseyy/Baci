import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

// Per-request verification budget: the staged set is frozen at stage
// time and lab-small (tiers + originals per accepted binding), so an
// unexpected explosion (pathological acceptances, runaway stage) fails
// closed instead of hashing unbounded bytes on every GET.
const MAX_STAGED_ENTRIES = 256;
const MAX_STAGED_BYTES = 256 * 1024 * 1024;

// Byte check over the staged tier/original paths: each file must exist
// AND hash to its verified digest. Deleted files fail closed instead of
// serving URLs for 404s; drifted (swapped) bytes fail closed instead of
// serving the wrong image. Re-staging here cannot help — files written
// after `next start` are not served — so the error names the operator fix.
export async function verifyStagedBytes(
  paths: readonly { path: string; sha256: string }[]
): Promise<void> {
  if (paths.length > MAX_STAGED_ENTRIES) {
    throw new Error(
      `merchant image pilot: ${paths.length} staged lab asset(s) exceed the ${MAX_STAGED_ENTRIES}-entry verification budget; re-run pnpm pilot:stage and restart the origin`
    );
  }
  const sizes = await Promise.all(
    paths.map((entry) => stat(entry.path).catch(() => null))
  );
  const totalBytes = sizes.reduce((sum, info) => sum + (info?.size ?? 0), 0);
  if (totalBytes > MAX_STAGED_BYTES) {
    throw new Error(
      `merchant image pilot: staged lab assets total ${totalBytes} bytes, exceeding the ${MAX_STAGED_BYTES}-byte verification budget; re-run pnpm pilot:stage and restart the origin`
    );
  }
  const bad = (
    await Promise.all(
      paths.map(async (entry, index) => {
        if (sizes[index] === null) {
          return `${entry.path} (missing)`;
        }
        const bytes = await readFile(entry.path).catch(() => null);
        if (bytes === null) {
          return `${entry.path} (missing)`;
        }
        if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          return `${entry.path} (hash drift)`;
        }
        return null;
      })
    )
  ).filter((entry): entry is string => entry !== null);
  if (bad.length > 0) {
    throw new Error(
      `merchant image pilot: ${bad.length} staged lab asset(s) unverified (e.g. ${bad[0]}); re-run pnpm pilot:stage and restart the origin`
    );
  }
}
