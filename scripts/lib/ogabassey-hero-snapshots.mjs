// Orchestrator for the OgaBassey mobile home-hero snapshot pipeline.
//
// Why snapshots? The hero LCP image is served from the CDN behind a
// connection the document cannot warm early. A snapshot is the same pixels
// re-encoded at the same quality/geometry the CDN AVIF tier would serve,
// stored under `apps/web/public/_hero/<slug>/` so it ships same-origin with
// immutable caching (see vercel.json). The render path only uses a snapshot
// when the manifest holds the exact slide-0 URL being rendered — rotated
// content misses its key and falls back to the CDN automatically.
//
// Invoked via scripts/generate-ogabassey-hero-snapshots.mjs:
//   node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey <sourceUrl> [...]
// The URL list is the COMPLETE set kept for the slug: entries not listed
// are dropped from the manifest and their orphaned `*.avif` files pruned.
// Always pass the committed slide-0 URL
// (OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL) first so the first-flush slot
// stays covered, plus any current shell slide-0 candidates.

import { resolve } from 'node:path';
import sharp from 'sharp';
import { parseSnapshotArgs } from './ogabassey-hero-snapshot-args.mjs';
import { bakeSnapshots } from './ogabassey-hero-snapshot-bake.mjs';
import { writeSnapshotManifest } from './ogabassey-hero-snapshot-manifest-write.mjs';
import { resolveSnapshotPaths } from './ogabassey-hero-snapshot-paths.mjs';
import { pruneSnapshotOrphans } from './ogabassey-hero-snapshot-prune.mjs';

export async function runGenerateOgabasseyHeroSnapshots(argv, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sharpImpl = deps.sharpImpl ?? sharp;
  const paths = resolveSnapshotPaths(deps.webRoot ?? null);
  const webRoot = paths.webRoot;
  const manifestPath = deps.manifestPath ?? paths.manifestPath;
  const root = deps.root ?? paths.root;
  const { slug, urls } = parseSnapshotArgs(argv);
  const outDir = resolve(webRoot, 'public/_hero', slug);
  const entries = await bakeSnapshots({
    fetchImpl,
    outDir,
    sharpImpl,
    slug,
    urls,
  });
  // Write before pruning: if the manifest read/serialize/write fails, the
  // old files are still on disk and the old manifest still references them.
  // (Baked files already exist, so the new manifest never dangles.)
  await writeSnapshotManifest({
    entries,
    manifestPath,
    root,
    skipBiomeFormat: deps.skipBiomeFormat ?? false,
    slug,
    webRoot,
  });
  pruneSnapshotOrphans(outDir, entries);
  return { entries, outDir, slug };
}
