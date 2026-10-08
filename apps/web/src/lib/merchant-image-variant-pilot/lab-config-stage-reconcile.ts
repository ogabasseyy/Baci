import 'server-only';
import { lstat, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// Restage reconciliation: pilot:stage only writes current files, so a
// rerun after the inventory changed would leave previous generations
// and originals reachable under /__pilot (startup accepts every 64-hex
// directory plus originals/). After a successful stage, remove generation
// dirs and originals this run did not write. Everything removed resolves
// under pilotStage first — a planted symlink inside the tree redirects
// the removal nowhere. Returns removed paths relative to pilotStage.
// Unknown entries are left alone: only managed shapes are reconciled.
const HEX64_PATTERN = /^[0-9a-f]{64}$/;

export async function reconcileStagedTree(input: {
  generationIds: readonly string[];
  pilotStage: string;
  stagedFiles: readonly string[];
}): Promise<string[]> {
  const removed: string[] = [];
  const currentGenerations = new Set(input.generationIds);
  const currentFiles = new Set(input.stagedFiles);
  const realStage = await realpath(input.pilotStage);
  const confined = async (path: string): Promise<string | null> => {
    const real = await realpath(path).catch(() => null);
    if (!real || (real !== realStage && !real.startsWith(realStage + sep))) {
      return null;
    }
    return real;
  };
  const entries = await readdir(input.pilotStage, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(input.pilotStage, entry.name);
    if (entry.isDirectory() && HEX64_PATTERN.test(entry.name)) {
      if (!currentGenerations.has(entry.name)) {
        const real = await confined(entryPath);
        if (real) {
          await rm(real, { force: true, recursive: true });
          removed.push(entry.name);
        }
        continue;
      }
      // Same-generation staleness: a re-encode drops old tier files.
      // Symlinks are unlinked directly (unlink never follows the link),
      // so a planted link cannot redirect the removal outside the tree.
      const tierFiles = await readdir(entryPath).catch(() => []);
      for (const file of tierFiles) {
        const tierPath = join(entryPath, file);
        const info = await lstat(tierPath).catch(() => null);
        if (!info || (!info.isFile() && !info.isSymbolicLink())) {
          continue;
        }
        if (!currentFiles.has(tierPath)) {
          if (info.isSymbolicLink()) {
            try {
              await unlink(tierPath);
              removed.push(relative(input.pilotStage, tierPath));
            } catch {
              // Gone or locked: leave it rather than misreport.
            }
          } else {
            const real = await confined(tierPath);
            if (real) {
              await rm(real, { force: true });
              removed.push(relative(input.pilotStage, tierPath));
            }
          }
        }
      }
      continue;
    }
    if (entry.isDirectory() && entry.name === 'originals') {
      const originals = await readdir(entryPath).catch(() => []);
      for (const file of originals) {
        const originalPath = join(entryPath, file);
        const info = await lstat(originalPath).catch(() => null);
        if (!info || (!info.isFile() && !info.isSymbolicLink())) {
          continue;
        }
        if (!currentFiles.has(originalPath)) {
          if (info.isSymbolicLink()) {
            try {
              await unlink(originalPath);
              removed.push(relative(input.pilotStage, originalPath));
            } catch {
              // Gone or locked: leave it rather than misreport.
            }
          } else {
            const real = await confined(originalPath);
            if (real) {
              await rm(real, { force: true });
              removed.push(relative(input.pilotStage, originalPath));
            }
          }
        }
      }
    }
  }
  return removed;
}
