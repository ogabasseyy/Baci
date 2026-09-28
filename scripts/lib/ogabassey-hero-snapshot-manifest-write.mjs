// Manifest writer for the hero snapshot pipeline: merges one slug's new
// entries with preserved tenants and writes the checked-in manifest file.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { snapshotError } from './ogabassey-hero-snapshot-config.mjs';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';
import { serializeSnapshotManifestFile } from './ogabassey-hero-snapshot-manifest-serialize.mjs';

export async function writeSnapshotManifest({
  entries,
  manifestPath,
  root,
  skipBiomeFormat = false,
  slug,
  webRoot,
}) {
  let existing;
  try {
    existing = readFileSync(manifestPath, 'utf8');
  } catch {
    throw snapshotError(
      `manifest not found at ${manifestPath}; it is checked in with the repo`
    );
  }
  const { tenants, version } = readSnapshotManifestTenants(existing);
  // Preserve other tenants' entries; this run owns only `slug`.
  const manifest = {};
  for (const [key, value] of Object.entries(tenants)) {
    if (key !== slug) manifest[key] = value;
  }
  manifest[slug] = {};
  for (const entry of [...entries].sort((a, b) =>
    a.sourceUrl.localeCompare(b.sourceUrl)
  )) {
    manifest[slug][entry.sourceUrl] = entry;
  }
  writeFileSync(
    manifestPath,
    serializeSnapshotManifestFile(manifest, version, new Date().toISOString())
  );
  // Keep `pnpm lint` green immediately after regenerating: biome owns final
  // line-breaking (long URLs exceed the print width). Not fatal when biome
  // is unavailable — the manifest is valid either way; lint flags it later.
  if (!skipBiomeFormat) {
    const biomeBin = [root, webRoot]
      .map((dir) => resolve(dir, 'node_modules/.bin/biome'))
      .find((bin) => existsSync(bin));
    if (biomeBin) {
      execFileSync(biomeBin, ['check', '--write', manifestPath], {
        cwd: root,
        stdio: 'pipe',
      });
    } else {
      console.warn(
        '[hero-snapshots] WARN: biome not found; run biome check --write on the manifest'
      );
    }
  }
  console.log(
    `[hero-snapshots] wrote manifest (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} for ${slug})`
  );
}
