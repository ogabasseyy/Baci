// Thin CLI wrapper: bakes same-origin AVIF snapshots for the OgaBassey
// mobile home-hero slide-0 image (see scripts/lib/ogabassey-hero-snapshots.mjs).
//
// Run:  node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey <sourceUrl> [...]
//       node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey --check [sourceUrl ...]
//       node scripts/generate-ogabassey-hero-snapshots.mjs --slug ogabassey --prune <sourceUrl> [...]
// Deps: sharp (already present via Next image optimization).

import { runGenerateOgabasseyHeroSnapshots } from './lib/ogabassey-hero-snapshots.mjs';

try {
  await runGenerateOgabasseyHeroSnapshots(process.argv);
} catch (error) {
  console.error(
    `[hero-snapshots] ERROR: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
