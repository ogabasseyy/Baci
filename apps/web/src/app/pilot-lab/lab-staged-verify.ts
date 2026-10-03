import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Byte check over the staged tier/original paths: each file must exist
// AND hash to its verified digest. Deleted files fail closed instead of
// serving URLs for 404s; drifted (swapped) bytes fail closed instead of
// serving the wrong image. Re-staging here cannot help — files written
// after `next start` are not served — so the error names the operator fix.
export async function verifyStagedBytes(
  paths: readonly { path: string; sha256: string }[]
): Promise<void> {
  const bad = (
    await Promise.all(
      paths.map(async (entry) => {
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
