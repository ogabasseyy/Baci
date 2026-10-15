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
// Unknown top-level entries fail the stage: the startup guard refuses
// every entry other than fillers, originals, and generation ids, so
// leaving one would report ok for a lab that cannot boot. Only managed
// shapes are reconciled. Staging writes flat files only, so any directory nested
// inside a current generation or originals is stale or planted and goes
// with its served descendants — skipping it would report completion
// while obsolete merchant bytes stay reachable under /__pilot.
export const HEX64_PATTERN = /^[0-9a-f]{64}$/;

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
  // Same-generation staleness, shared by current generation dirs and
  // originals: a re-encode drops old tier files, and any nested
  // directory — stale leftover or planted tree — goes with its served
  // descendants. Directories always go, even at a currently staged
  // path: staging writes files only, so a directory there squats a
  // file path and must not survive. Symlinks are unlinked directly
  // (unlink never follows the link), so a planted link cannot redirect
  // the removal outside the tree.
  const reconcileChild = async (childPath: string): Promise<void> => {
    const info = await lstat(childPath).catch(() => null);
    if (!info) {
      return;
    }
    if (info.isDirectory()) {
      const real = await confined(childPath);
      if (real) {
        await rm(real, { force: true, recursive: true });
        removed.push(relative(input.pilotStage, childPath));
      }
      return;
    }
    if (!info.isFile() && !info.isSymbolicLink()) {
      // Special files (FIFO/socket/device) are never valid staged
      // content at any path: a FIFO at a bound path would hang the
      // staged write, a device node would redirect it, and an unbound
      // one would fail boot confinement while re-staging never
      // repairs it. Unlink (never follows the entry) and fail staging
      // loudly when the removal itself fails.
      await unlink(childPath);
      removed.push(relative(input.pilotStage, childPath));
      return;
    }
    if (!currentFiles.has(childPath)) {
      if (info.isSymbolicLink()) {
        try {
          await unlink(childPath);
          removed.push(relative(input.pilotStage, childPath));
        } catch {
          // Gone or locked: leave it rather than misreport.
        }
      } else {
        const real = await confined(childPath);
        if (real) {
          await rm(real, { force: true });
          removed.push(relative(input.pilotStage, childPath));
        }
      }
    }
  };
  const entries = await readdir(input.pilotStage, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(input.pilotStage, entry.name);
    // Mirror the startup guard's allowlist exactly: fillers (a real
    // directory — a file or link there fails boot too), originals, and
    // generation ids. Anything else fails the stage rather than
    // reporting ok for a tree the guard will refuse to start.
    const managed =
      entry.name === 'originals' || HEX64_PATTERN.test(entry.name);
    if (!managed) {
      const fillersDir = entry.name === 'fillers' && entry.isDirectory();
      if (!fillersDir) {
        throw new Error(
          `merchant image pilot: unknown staged entry "${entry.name}" — remove it or stage into a clean tree`
        );
      }
      continue;
    }
    // Managed names are always directories (generation dirs, originals):
    // a file or symlink squatting one is never legitimate. Unlink it
    // (never following the link) instead of silently skipping — the
    // startup guard rejects the same name as unsafe, so skipping would
    // stage a lab that cannot start while reporting ok.
    if (
      !entry.isDirectory() &&
      (entry.name === 'originals' || HEX64_PATTERN.test(entry.name))
    ) {
      await unlink(entryPath);
      removed.push(entry.name);
      continue;
    }
    if (entry.isDirectory() && HEX64_PATTERN.test(entry.name)) {
      if (!currentGenerations.has(entry.name)) {
        const real = await confined(entryPath);
        if (real) {
          await rm(real, { force: true, recursive: true });
          removed.push(entry.name);
        }
        continue;
      }
      // Fail closed: an unreadable generation or originals directory
      // aborts the stage. Treating it as empty would report completion
      // while stale bytes stay reachable under /__pilot.
      const tierFiles = await readdir(entryPath);
      for (const file of tierFiles) {
        await reconcileChild(join(entryPath, file));
      }
      continue;
    }
    if (entry.isDirectory() && entry.name === 'originals') {
      const originals = await readdir(entryPath);
      for (const file of originals) {
        await reconcileChild(join(entryPath, file));
      }
    }
  }
  return removed;
}
