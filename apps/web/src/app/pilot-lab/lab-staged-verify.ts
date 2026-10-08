import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

// Per-request verification budget: the staged set is frozen at stage
// time and lab-small (tiers + originals per accepted binding), so an
// unexpected explosion (pathological acceptances, runaway stage) fails
// closed instead of hashing unbounded bytes on every GET.
const MAX_STAGED_ENTRIES = 256;
const MAX_STAGED_BYTES = 256 * 1024 * 1024;

// Last fully verified snapshot: size+mtime+ctime per path, keyed by the
// exact staged set (paths AND expected digests). Repeat GETs re-stat
// (cheap) and skip the re-read/re-hash only when every entry is
// byte-identical to a snapshot that already passed the full check. Any
// size change, mtime change, ctime change, missing file, or changed
// expectation re-runs the full read+hash below. ctime closes the
// mtime-pinning hole: utimens can freeze mtime after a rewrite, but the
// write itself bumps ctime, so pinned-mtime drift always re-hashes.
let lastVerified: { fingerprint: string; key: string } | null = null;

function snapshotKey(paths: readonly { path: string; sha256: string }[]) {
  return JSON.stringify(paths.map((entry) => [entry.path, entry.sha256]));
}

function fingerprintStats(
  sizes: readonly ({ ctimeMs: number; mtimeMs: number; size: number } | null)[]
): string | null {
  const parts: [number, number, number][] = [];
  for (const info of sizes) {
    if (info === null) {
      return null;
    }
    parts.push([info.size, info.mtimeMs, info.ctimeMs]);
  }
  return JSON.stringify(parts);
}

// Byte check over the staged tier/original paths: each file must exist
// AND hash to its verified digest. Deleted files fail closed instead of
// serving URLs for 404s; drifted (swapped) bytes fail closed instead of
// serving the wrong image. Re-staging here cannot help — files written
// after `next start` are not served — so the error names the operator fix.
export async function verifyStagedBytes(
  paths: readonly { path: string; sha256: string }[]
): Promise<void> {
  // Deduplicate identical references first: a narrow source or
  // same-codec passthrough reused for several rungs lists the same
  // content-hash path multiple times, and counting each reference
  // would reject a valid bounded staging set above the byte budget.
  // Keyed by path AND hash so conflicting expectations for one path
  // still surface as separate entries below.
  const seen = new Map<string, { path: string; sha256: string }>();
  for (const entry of paths) {
    const key = `${entry.path}\n${entry.sha256}`;
    if (!seen.has(key)) {
      seen.set(key, entry);
    }
  }
  const unique = [...seen.values()];
  if (unique.length > MAX_STAGED_ENTRIES) {
    throw new Error(
      `merchant image pilot: ${unique.length} staged lab asset(s) exceed the ${MAX_STAGED_ENTRIES}-entry verification budget; re-run pnpm pilot:stage and restart the origin`
    );
  }
  const sizes = await Promise.all(
    unique.map((entry) => stat(entry.path).catch(() => null))
  );
  const totalBytes = sizes.reduce((sum, info) => sum + (info?.size ?? 0), 0);
  if (totalBytes > MAX_STAGED_BYTES) {
    throw new Error(
      `merchant image pilot: staged lab assets total ${totalBytes} bytes, exceeding the ${MAX_STAGED_BYTES}-byte verification budget; re-run pnpm pilot:stage and restart the origin`
    );
  }
  const key = snapshotKey(unique);
  const fingerprint = fingerprintStats(sizes);
  if (
    fingerprint !== null &&
    lastVerified?.key === key &&
    lastVerified.fingerprint === fingerprint
  ) {
    return;
  }
  const bad = (
    await Promise.all(
      unique.map(async (entry, index) => {
        if (sizes[index] === null) {
          return { detail: 'missing', path: entry.path };
        }
        const bytes = await readFile(entry.path).catch(() => null);
        if (bytes === null) {
          return { detail: 'missing', path: entry.path };
        }
        if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
          return { detail: 'hash drift', path: entry.path };
        }
        return null;
      })
    )
  ).filter(
    (entry): entry is { detail: string; path: string } => entry !== null
  );
  if (bad.length > 0) {
    // Full paths go to the server log only: the thrown message can surface
    // in route error output on shared hosts with the lab flag on.
    console.error(
      `merchant image pilot: unverified staged assets:\n${bad.map((entry) => `${entry.path} (${entry.detail})`).join('\n')}`
    );
    const first = bad[0] as { detail: string; path: string };
    throw new Error(
      `merchant image pilot: ${bad.length} staged lab asset(s) unverified (e.g. ${basename(first.path)} ${first.detail}); re-run pnpm pilot:stage and restart the origin`
    );
  }
  if (fingerprint !== null) {
    lastVerified = { fingerprint, key };
  }
}
