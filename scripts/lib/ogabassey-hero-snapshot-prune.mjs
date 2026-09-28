// Orphan pruning for the hero snapshot pipeline: deletes pipeline-managed
// files no longer referenced by the new manifest.

import { readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANAGED_FILE_PATTERN } from './ogabassey-hero-snapshot-config.mjs';

export function pruneSnapshotOrphans(outDir, entries) {
  const referenced = new Set();
  for (const entry of entries) {
    referenced.add(entry.href.split('/').pop());
    for (const part of entry.srcSet.split(',')) {
      const file = part.trim().split(/\s+/)[0].split('/').pop();
      if (file) referenced.add(file);
    }
  }
  const pruned = [];
  for (const file of readdirSync(outDir)) {
    // Only ever delete files this pipeline could have written.
    if (!MANAGED_FILE_PATTERN.test(file) || referenced.has(file)) {
      continue;
    }
    rmSync(resolve(outDir, file));
    pruned.push(file);
    console.log(`[hero-snapshots] pruned orphan ${file}`);
  }
  return pruned;
}
