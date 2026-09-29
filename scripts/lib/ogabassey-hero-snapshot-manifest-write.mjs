// Manifest writer for the hero snapshot pipeline: merges one slug's new
// entries with preserved tenants and writes the checked-in manifest file.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { HeroSnapshotError } from './ogabassey-hero-snapshot-errors.mjs';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';
import { serializeSnapshotManifestFile } from './ogabassey-hero-snapshot-manifest-serialize.mjs';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

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
    throw new HeroSnapshotError(
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
  // Atomic replacement: serialize and format a temp sibling, then rename
  // over the live manifest. A failed write (ENOSPC, I/O error) or a
  // failed formatter can therefore never leave a truncated manifest behind
  // while the orchestrator deletes this run's baked files. The temp file
  // shares the manifest's directory so the rename stays on one filesystem,
  // and keeps the `.ts` extension so the formatter accepts it. Leftovers
  // (only from a killed process) are removed at the start of the next run.
  for (const stale of readdirSync(dirname(manifestPath))) {
    if (stale.startsWith('ogabassey-home-hero-snapshot-manifest.tmp-')) {
      rmSync(resolve(dirname(manifestPath), stale), { force: true });
    }
  }
  const tmpPath = manifestPath.replace(/\.ts$/, `.tmp-${process.pid}.ts`);
  try {
    writeFileSync(
      tmpPath,
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
        try {
          execFileSync(biomeBin, ['check', '--write', tmpPath], {
            cwd: root,
            stdio: 'pipe',
          });
        } catch (error) {
          throw new HeroSnapshotError(
            `manifest formatting failed: ${errorMessage(error)}`
          );
        }
      } else {
        console.warn(
          '[hero-snapshots] WARN: biome not found; run biome check --write on the manifest'
        );
      }
    }
    renameSync(tmpPath, manifestPath);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
  console.log(
    `[hero-snapshots] wrote manifest (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} for ${slug})`
  );
}
