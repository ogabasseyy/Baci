// Default path resolution for the hero snapshot pipeline.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveSnapshotPaths(webRoot = null) {
  const resolvedWebRoot =
    webRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web');
  return {
    webRoot: resolvedWebRoot,
    manifestPath: resolve(
      resolvedWebRoot,
      'src/config/ogabassey-home-hero-snapshot-manifest.ts'
    ),
    // Repo root is TWO levels above apps/web (apps/web -> apps -> root).
    root: resolve(resolvedWebRoot, '../..'),
  };
}
