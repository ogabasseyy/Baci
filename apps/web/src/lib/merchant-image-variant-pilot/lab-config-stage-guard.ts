import 'server-only';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { HEX64_PATTERN } from './lab-config-stage-reconcile';

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
//
// The full walk only runs when the tree drifts, and the allowlist
// resolution below runs once per stagedPaths array: repeat requests
// skip straight to the directory fingerprint (a few lstats, no
// listings, no hashes, no realpaths), so per-request verification
// stays on the stat fast path and cannot contaminate lab timing. A
// failed scan never records, so drift keeps failing until the
// operator re-stages.

// Resolved-allowlist cache, keyed by stagedPaths array identity: the
// frozen lab runtime passes the SAME array on every request, so repeat
// requests skip both realpath passes (2N syscalls) and go straight to
// the fingerprint. A fresh array (new config load) re-resolves, and a
// mixed-roots throw is never cached. Arrays are treated as immutable —
// the loader builds them once and the runtime freezes the config
// around them — so a hit can never disagree with the live allowlist.
const resolvedAllowlistCache = new WeakMap<
  readonly { path: string }[],
  { expected: ReadonlySet<string>; realStage: string }
>();

// Exported for the fast-path pinning test: the per-request cost claim
// (no realpaths after the first resolution) rests on this cache.
export async function resolveAllowlist(
  stagedPaths: readonly { path: string }[],
  stageRoot: string | undefined
): Promise<{ expected: ReadonlySet<string>; realStage: string } | null> {
  const cached = resolvedAllowlistCache.get(stagedPaths);
  if (cached) {
    return cached;
  }
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
    // No allowlist entries: the stage root cannot derive from staged
    // paths, but an empty binding set must not silently accept a
    // populated tree — with nothing bound, any generation or originals
    // content is unbound by definition. Callers pass their known root
    // for this branch; without one there is nothing to enumerate.
    if (stageRoot) {
      await assertEmptyAllowlistTree(stageRoot);
    }
    return null;
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
  const resolved = { expected, realStage };
  resolvedAllowlistCache.set(stagedPaths, resolved);
  return resolved;
}

export async function assertNoUnexpectedStagedFiles(
  stagedPaths: readonly { path: string }[],
  stageRoot?: string,
  // Pinned filler paths (no hashes needed — membership only): the
  // byte verifier hashes the three pinned paths but never lists the
  // directory, so without this a fourth file planted under fillers/
  // stays publicly reachable through Next's static namespace while
  // every lab render still passes.
  fillerPaths: readonly string[] = []
): Promise<void> {
  const resolved = await resolveAllowlist(stagedPaths, stageRoot);
  if (!resolved) {
    return;
  }
  const { expected: cached, realStage } = resolved;
  // Copy: the cached set is shared across calls, and different call
  // sites bind different filler lists — mutating it would leak one
  // caller's allowlist into another's.
  const expected = new Set(cached);
  for (const filler of fillerPaths) {
    const real = await realpath(filler).catch(() => null);
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
  // Drift gate: the directory fingerprint (stats only) decides whether
  // the full walk below runs. Sound because every drift this walk can
  // catch moves a fingerprinted directory: new entries bump the parent
  // dir's mtime/ctime, new top-level generations bump the root, and
  // content-only swaps change no file set (per-file bytes stay on the
  // verifyStagedBytes fast path, which always runs). ctime rides along
  // because utimens can pin mtime but never ctime.
  const fingerprint = await stageFingerprint(
    realStage,
    expected,
    currentGenDirs
  );
  if (lastScan?.root === realStage && lastScan.fingerprint === fingerprint) {
    return;
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
  // Fillers only when the caller binds them: without pinned entries
  // there is no allowlist for this directory, and the boot shape
  // guard owns the unbound case.
  if (fillerPaths.length > 0) {
    await checkDir(join(realStage, 'fillers'), 'fillers');
  }
  // Stage-root enumeration: the only legal top-level entries are the
  // managed dirs (originals/, fillers/) and current generation dirs.
  // A root-level file or a non-hex directory would otherwise never be
  // enumerated — checkDir only visits the known subdirs — while Next
  // serves public/__pilot/... statically without invoking a lab
  // handler. Unreferenced 64-hex dirs refuse with their own message
  // (restored, planted, or stale from a crashed stage); anything else
  // refuses as unbound. Allowed names must be real directories (the
  // Dirent check is lstat-based, so a squatting file or symlink
  // refuses too).
  const allowedTopNames = new Set([
    'fillers',
    'originals',
    ...[...currentGenDirs].map((dir) => basename(dir)),
  ]);
  const topEntries = await readdir(realStage, { withFileTypes: true }).catch(
    () => null
  );
  if (topEntries) {
    for (const entry of topEntries) {
      if (!allowedTopNames.has(entry.name)) {
        if (HEX64_PATTERN.test(entry.name)) {
          throw new Error(
            `merchant image pilot: unreferenced generation directory "${entry.name}" — re-stage to reconcile`
          );
        }
        throw new Error(
          `merchant image pilot: staged entry "${entry.name}" has no inventory binding — re-stage to reconcile`
        );
      }
      if (!entry.isDirectory()) {
        throw new Error(
          `merchant image pilot: staged entry "${entry.name}" is not a directory — re-stage to reconcile`
        );
      }
    }
  }
  // Record only on success: a throw above skips this, so drift keeps
  // failing on every request until the operator re-stages.
  lastScan = { fingerprint, root: realStage };
}

// Last passing scan, keyed by stage root: the frozen runtime binds one
// root per boot, so a single entry covers production; anything else
// (tests, a re-rooted stage) simply misses and rescans.
let lastScan: { fingerprint: string; root: string } | null = null;

async function stageFingerprint(
  realStage: string,
  expected: ReadonlySet<string>,
  currentGenDirs: ReadonlySet<string>
): Promise<string> {
  const parts = [realStage, ...[...expected].sort()];
  for (const dir of [
    realStage,
    join(realStage, 'originals'),
    join(realStage, 'fillers'),
    ...currentGenDirs,
  ]) {
    const stat = await lstat(dir).catch(() => null);
    parts.push(
      stat ? `${dir}:${stat.mtimeMs}:${stat.ctimeMs}` : `${dir}:missing`
    );
  }
  // Root listing names, not just the root stat: a plant outside the
  // known subdirs must invalidate the fast path even on filesystems
  // with coarse stat granularity.
  const topNames = await readdir(realStage).catch(() => null);
  parts.push(
    topNames ? `root:${[...topNames].sort().join(',')}` : 'root:missing'
  );
  return parts.join('\n');
}

// Empty-allowlist twin of the enumeration above: with zero staged
// paths, any servable content is unbound by definition. Name-based
// presence only (no traversal into entries, so a symlinked name
// cannot redirect the check); fillers/ is the boot shape guard's
// business (pinned fixtures this check cannot verify), but root-level
// files, squatting non-directories, and non-empty non-hex dirs refuse
// like the bound path. An unreadable root passes — there is nothing
// to serve from it.
async function assertEmptyAllowlistTree(stageRoot: string): Promise<void> {
  const topEntries = await readdir(stageRoot, { withFileTypes: true }).catch(
    () => null
  );
  if (!topEntries) {
    return;
  }
  for (const entry of topEntries) {
    if (entry.name === 'fillers') {
      continue;
    }
    if (!entry.isDirectory()) {
      throw new Error(
        `merchant image pilot: staged file "${entry.name}" with an empty binding set — re-stage to reconcile`
      );
    }
    if (entry.name !== 'originals' && !HEX64_PATTERN.test(entry.name)) {
      const extra = await readdir(join(stageRoot, entry.name)).catch(
        () => null
      );
      if (extra && extra.length > 0) {
        throw new Error(
          `merchant image pilot: staged directory "${entry.name}" with an empty binding set — re-stage to reconcile`
        );
      }
      continue;
    }
    const children = await readdir(join(stageRoot, entry.name)).catch(
      () => null
    );
    if (children && children.length > 0) {
      throw new Error(
        `merchant image pilot: staged content with an empty binding set under "${entry.name}" — re-stage to reconcile`
      );
    }
  }
}
