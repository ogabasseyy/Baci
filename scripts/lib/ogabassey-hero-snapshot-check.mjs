// Freshness checking for hero snapshots: CDN source paths are mutable
// (the CDN transformer keys its cache on source size + mtime), so an exact
// manifest URL match alone cannot prove the checked-in bytes still
// represent the source. This mode re-fetches each kept source and compares
// its sha256 against the manifest's `sourceSha256`, failing loudly on
// drift so an in-place merchandising overwrite is re-baked instead of
// served stale indefinitely. Intended for scheduled runs; automation
// wiring is a follow-up to this change.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HeroSnapshotError } from './ogabassey-hero-snapshot-errors.mjs';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';
import { fetchSnapshotSource } from './ogabassey-hero-snapshot-source.mjs';

export async function checkSnapshotFreshness({
  fetchImpl,
  manifestPath,
  slug,
  urls,
}) {
  let existing;
  try {
    existing = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new HeroSnapshotError(
      `manifest not found at ${manifestPath}; it is checked in with the repo`
    );
  }
  const { tenants } = readSnapshotManifestTenants(existing);
  const entries = tenants[slug];
  if (!entries || Object.keys(entries).length === 0) {
    throw new HeroSnapshotError(`manifest keeps no entries for slug ${slug}`);
  }
  const targets = urls.length > 0 ? urls : Object.keys(entries).sort();
  for (const url of targets) {
    if (!entries[url]) {
      throw new HeroSnapshotError(
        `manifest keeps no entry for ${url} under slug ${slug}`
      );
    }
  }
  const drifted = [];
  for (const url of targets) {
    // eslint-disable-next-line no-await-in-loop
    const sourceBytes = await fetchSnapshotSource(url, fetchImpl);
    const actual = createHash('sha256').update(sourceBytes).digest('hex');
    if (actual === entries[url].sourceSha256) {
      console.log(`[hero-snapshots] fresh ${url}`);
    } else {
      console.log(`[hero-snapshots] DRIFTED ${url}`);
      drifted.push(url);
    }
  }
  if (drifted.length > 0) {
    throw new HeroSnapshotError(
      `snapshot drift for ${drifted.length} url(s), re-bake: ${drifted.join(', ')}`
    );
  }
  return { checked: targets, drifted };
}
