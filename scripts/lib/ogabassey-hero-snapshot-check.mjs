// Freshness checking for hero snapshots: CDN source paths are mutable
// (the CDN transformer keys its cache on source size + mtime), so an exact
// manifest URL match alone cannot prove the checked-in bytes still
// represent the source. This mode re-fetches each kept source and compares
// its sha256 against the manifest's `sourceSha256`, failing loudly on
// drift so an in-place merchandising overwrite is re-baked instead of
// served stale indefinitely. It also rejects entries baked longer ago
// than SNAPSHOT_MAX_AGE_MS: the runtime resolver is wall-clock-free by
// design (prerendered and request-time consumers must agree), so the
// re-bake cadence is enforced here, on a schedule — see
// .github/workflows/ogabassey-hero-snapshot-freshness.yml. Every run
// additionally verifies the manifest-referenced local AVIF files exist
// with bytes matching their content-addressed filenames, so a deleted or
// hand-corrupted asset fails the check even when the remote hash matches.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SNAPSHOT_MAX_AGE_MS } from './ogabassey-hero-snapshot-config.mjs';
import { HeroSnapshotError } from './ogabassey-hero-snapshot-errors.mjs';
import { verifySnapshotLocalAssets } from './ogabassey-hero-snapshot-local-assets.mjs';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';
import { fetchSnapshotSource } from './ogabassey-hero-snapshot-source.mjs';

export async function checkSnapshotFreshness({
  fetchImpl,
  manifestPath,
  outDir,
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
  const expired = [];
  const hashTargets = [];
  for (const url of targets) {
    const bakedAt = Date.parse(entries[url].bakedAt ?? '');
    if (!Number.isFinite(bakedAt)) {
      throw new HeroSnapshotError(
        `snapshot entry for ${url} under slug ${slug} has no parseable bakedAt; re-bake to repair the manifest`
      );
    }
    if (Date.now() - bakedAt > SNAPSHOT_MAX_AGE_MS) {
      console.log(`[hero-snapshots] EXPIRED ${url}`);
      expired.push(url);
    } else {
      hashTargets.push(url);
    }
  }
  // Local assets before network: a deleted or hand-corrupted AVIF must
  // fail the check even when the remote source hash still matches.
  const { verifiedFiles } = verifySnapshotLocalAssets({
    entries,
    outDir,
    urls: targets,
  });
  console.log(
    `[hero-snapshots] verified ${verifiedFiles.length} local asset(s)`
  );
  const drifted = [];
  for (const url of hashTargets) {
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
  if (drifted.length > 0 || expired.length > 0) {
    const reasons = [];
    if (drifted.length > 0) {
      reasons.push(`drifted: ${drifted.join(', ')}`);
    }
    if (expired.length > 0) {
      reasons.push(`expired (re-bake required): ${expired.join(', ')}`);
    }
    throw new HeroSnapshotError(
      `snapshot freshness failed for ${drifted.length + expired.length} url(s), re-bake: ${reasons.join('; ')}`
    );
  }
  return { checked: targets, drifted, expired };
}
