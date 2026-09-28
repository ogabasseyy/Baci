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
//   node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey --check [sourceUrl ...]
//   node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey --prune <sourceUrl> [...]
// The URL list is the COMPLETE set kept for the slug: entries not listed
// are dropped from the manifest. Always pass the committed slide-0 URL
// (OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL) first so the first-flush slot
// stays covered, plus any current shell slide-0 candidates.
//
// Orphan `*.avif` files are deleted ONLY with `--prune`: published snapshot
// URLs are immutable-cached for a year and may still be referenced by
// documents served before this run, so a bake never deletes on its own.
// `--check` re-fetches kept sources and fails on hash drift (in-place
// merchandising overwrites) or bake age past SNAPSHOT_MAX_AGE_MS; it runs
// on a schedule via .github/workflows/ogabassey-hero-snapshot-freshness.yml
// and needs no installed dependencies.

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSnapshotArgs } from './ogabassey-hero-snapshot-args.mjs';
import { bakeSnapshots } from './ogabassey-hero-snapshot-bake.mjs';
import { checkSnapshotFreshness } from './ogabassey-hero-snapshot-check.mjs';
import { writeSnapshotManifest } from './ogabassey-hero-snapshot-manifest-write.mjs';
import { resolveSnapshotPaths } from './ogabassey-hero-snapshot-paths.mjs';
import { pruneSnapshotOrphans } from './ogabassey-hero-snapshot-prune.mjs';

export async function runGenerateOgabasseyHeroSnapshots(argv, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const paths = resolveSnapshotPaths(deps.webRoot ?? null);
  const webRoot = paths.webRoot;
  const manifestPath = deps.manifestPath ?? paths.manifestPath;
  const root = deps.root ?? paths.root;
  const { check, prune, slug, urls } = parseSnapshotArgs(argv);
  if (check) {
    return checkSnapshotFreshness({ fetchImpl, manifestPath, slug, urls });
  }
  // sharp is loaded only on the bake path: `--check` must run on bare
  // node (stdlib + global fetch) so the scheduled freshness workflow needs
  // no dependency install.
  const sharpImpl = deps.sharpImpl ?? (await import('sharp')).default;
  const outDir = resolve(webRoot, 'public/_hero', slug);
  const { bakedPaths, entries } = await bakeSnapshots({
    fetchImpl,
    outDir,
    sharpImpl,
    slug,
    urls,
  });
  // Write before pruning: if the manifest read/serialize/write fails, the
  // old files are still on disk and the old manifest still references them.
  // (Baked files already exist, so the new manifest never dangles.) On a
  // write failure, also remove this run's baked files so they cannot be
  // committed accidentally while unreferenced; pre-existing files were
  // never tracked and stay untouched.
  try {
    await writeSnapshotManifest({
      entries,
      manifestPath,
      root,
      skipBiomeFormat: deps.skipBiomeFormat ?? false,
      slug,
      webRoot,
    });
  } catch (error) {
    for (const filePath of bakedPaths) {
      rmSync(filePath, { force: true });
    }
    throw error;
  }
  // Orphan deletion is explicit (`--prune`): published snapshot URLs are
  // immutable-cached for a year and may still be referenced by documents
  // served before this run, so a bake never deletes on its own.
  if (prune) {
    pruneSnapshotOrphans(outDir, entries);
  }
  return { entries, outDir, slug };
}
