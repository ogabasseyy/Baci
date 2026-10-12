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

// Startup/request twin of reconcileStagedTree (which only runs at
// stage time): a regular file planted under originals/ or a current
// generation AFTER staging passes the boot guard — links and
// non-regular files are all it rejects — and sits in Next's static
// /__pilot namespace with no inventory, manifest, or acceptance
// binding, while verification only re-checks the expected stagedPaths.
// Every file under originals/ and current generation dirs must be an
// expected staged path; nested dirs, links, and special files refuse.
// Generation dirs with no current binding refuse too: the startup
// guard serves every 64-hex directory by design, so a restored or
// planted generation would otherwise leave unbound files reachable
// through /__pilot with no traversal noticing. Stale dirs from a
// crashed stage fail closed here with the re-stage fix.
export async function assertNoUnexpectedStagedFiles(
  stagedPaths: readonly { path: string }[]
): Promise<void> {
  // The stage root derives from the allowlist itself (every staged path
  // sits two levels under it), so callers pass no second root that
  // could disagree with the allowlist. Mixed roots fail closed.
  const stages = new Set<string>();
  for (const entry of stagedPaths) {
    const real = await realpath(entry.path).catch(() => null);
    if (real) {
      stages.add(join(real, '..', '..'));
    }
  }
  if (stages.size === 0) {
    return;
  }
  if (stages.size > 1) {
    throw new Error(
      'merchant image pilot: staged paths span multiple stage roots'
    );
  }
  const [realStage] = [...stages];
  const expected = new Set<string>();
  for (const entry of stagedPaths) {
    const real = await realpath(entry.path).catch(() => null);
    if (real) {
      expected.add(real);
    }
  }
  const currentGenDirs = new Set<string>();
  for (const file of expected) {
    const [top] = relative(realStage, file).split(sep);
    if (top && HEX64_PATTERN.test(top)) {
      currentGenDirs.add(join(realStage, top));
    }
  }
  const checkDir = async (dir: string, label: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      () => null
    );
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        throw new Error(
          `merchant image pilot: unexpected staged directory "${entry.name}" under ${label}`
        );
      }
      if (!entry.isFile()) {
        throw new Error(
          `merchant image pilot: staged entry "${entry.name}" under ${label} is not a regular file`
        );
      }
      const real = await realpath(full);
      if (!expected.has(real)) {
        throw new Error(
          `merchant image pilot: staged file "${entry.name}" under ${label} has no inventory binding`
        );
      }
    }
  };
  await checkDir(join(realStage, 'originals'), 'originals');
  for (const dir of currentGenDirs) {
    await checkDir(dir, 'a current generation');
  }
  // Unreferenced generation dirs: current generations are the only
  // ones with inventory bindings, so any other 64-hex directory —
  // restored after staging, planted outright, or stale from a crashed
  // stage — refuses instead of serving unbound files. A hex-named
  // symlink refuses too: only real staged files build currentGenDirs,
  // so a link name can never appear there.
  const topEntries = await readdir(realStage, { withFileTypes: true }).catch(
    () => null
  );
  if (topEntries) {
    for (const entry of topEntries) {
      if (!HEX64_PATTERN.test(entry.name)) {
        continue;
      }
      if (!currentGenDirs.has(join(realStage, entry.name))) {
        throw new Error(
          `merchant image pilot: unreferenced generation directory "${entry.name}" — re-stage to reconcile`
        );
      }
    }
  }
}
