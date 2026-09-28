// Manifest body reader for the hero snapshot pipeline.

import { snapshotError } from './ogabassey-hero-snapshot-config.mjs';

export function readSnapshotManifestTenants(existing) {
  const versionMatch = existing.match(
    /OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = (\d+)/
  );
  const version = versionMatch ? Number(versionMatch[1]) : 1;
  // The body is evaluated as a TS object literal (not JSON.parse) so
  // biome-formatted output — single quotes, unquoted keys, trailing commas —
  // round-trips. This file is generator-owned; a hand-corrupted body fails
  // loudly below.
  const blockMatch = existing.match(/> = (\{[\s\S]*?\n\});\s*$/);
  if (!blockMatch) {
    // A present-but-unlocatable body is corruption, not an empty manifest:
    // returning no tenants here would rewrite the file with only the
    // current slug, silently discarding every other tenant.
    throw snapshotError(
      'existing manifest body cannot be located; fix it before regenerating'
    );
  }
  let parsed;
  try {
    parsed = new Function(`return (${blockMatch[1]});`)();
  } catch {
    throw snapshotError(
      'existing manifest body is not parseable; fix it before regenerating'
    );
  }
  return { tenants: { ...parsed }, version };
}
