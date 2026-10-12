import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { isPilotLabEnabled } from './pilot-lab-enabled';

// Only these committed synthetic fixtures may exist in a non-lab public
// tree. Staged merchant originals and generations must never enter one.
const FILLERS: Readonly<Record<string, string>> = {
  'grid-filler-600x400-a.png':
    '6ef0972498624161834c3fe6cba5dbf047f3ca536d272ebcc6545b18cda5f83a',
  'grid-filler-600x400-b.png':
    '092ad111e2f8680afc232ad66813d23e831dbf73d334bc104d9db52f61138a86',
  'grid-filler-600x400-c.png':
    'a6d5d0159f63ef07a8bc25aae2a189e47263ddc12129b46659c1707c8b04ac61',
};

function directoryExists(path: string): boolean {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error('unsafe pilot public directory');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertConfinedEntry(root: string, name: string): void {
  const entry = join(root, name);
  const stat = lstatSync(entry);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      `lab public pilot tree entry "${name}" is not a confined directory`
    );
  }
  const realRoot = realpathSync(root);
  const confined = (candidate: string): void => {
    const realCandidate = realpathSync(candidate);
    if (
      realCandidate !== realRoot &&
      !realCandidate.startsWith(`${realRoot}${sep}`)
    ) {
      throw new Error(
        `lab public pilot tree entry "${name}" escapes the pilot root`
      );
    }
  };
  confined(entry);
  // The directory check alone is not enough: a symlink nested one level
  // down (…/originals/evil → /etc) passes the entry gate and is still
  // served by Next, so every descendant gets the same lstat/realpath
  // confinement. lstat never follows links, so loops cannot hang this.
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const child of readdirSync(current)) {
      const childPath = join(current, child);
      const childStat = lstatSync(childPath);
      if (childStat.isSymbolicLink()) {
        throw new Error(
          `lab public pilot tree entry "${name}" contains a symlink`
        );
      }
      // Hardlinks have no separate target for realpath to expose: a
      // file hardlinked from outside would pass confinement and be
      // served, so every non-directory must be single-linked.
      // Directories always carry extra links (. entries), hence the
      // directory carve-out.
      if (!childStat.isDirectory() && childStat.nlink > 1) {
        throw new Error(
          `lab public pilot tree entry "${name}" contains a hardlinked file`
        );
      }
      // Next serves every non-directory public entry: a FIFO, socket,
      // or device with one link would pass the checks above and then
      // block (or leak) on GET, so every descendant must be a regular
      // file or a directory.
      if (!childStat.isDirectory() && !childStat.isFile()) {
        throw new Error(
          `lab public pilot tree entry "${name}" contains a special file`
        );
      }
      confined(childPath);
      if (childStat.isDirectory()) {
        pending.push(childPath);
      }
    }
  }
}

function assertFillers(fillersDir: string, labEnabled: boolean): void {
  // The caller lists this entry, so it existed a moment ago — but a
  // file squatting the name (or a mid-boot deletion) is not the
  // directory: fail with the curated message, not a raw ENOTDIR/ENOENT
  // path leak from the read below.
  if (!directoryExists(fillersDir)) {
    throw new Error(
      labEnabled
        ? 'lab public pilot tree is missing the fillers directory'
        : 'non-lab public pilot tree is missing the fillers directory'
    );
  }
  const files = readdirSync(fillersDir);
  for (const file of files) {
    const expected = FILLERS[file];
    const path = join(fillersDir, file);
    const stat = lstatSync(path);
    // Fillers are hash-pinned at boot, but a hardlink lets an outside
    // writer mutate the served bytes after the check: same nlink>1
    // multi-link rejection as the generation/original guard above.
    if (stat.nlink > 1) {
      throw new Error(
        labEnabled
          ? 'lab public pilot tree contains a hardlinked filler'
          : 'non-lab public pilot tree contains a hardlinked filler'
      );
    }
    if (
      !expected ||
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 2_000_000 ||
      createHash('sha256').update(readFileSync(path)).digest('hex') !== expected
    ) {
      throw new Error(
        labEnabled
          ? 'lab public pilot tree contains an unapproved filler'
          : 'non-lab public pilot tree contains an unapproved filler'
      );
    }
  }
  // The exact complete set is required in BOTH modes: the lab grid
  // references all three filler URLs (a subset would start the lab
  // with broken sibling-card images), and a partial set in a non-lab
  // tree is a packaging anomaly or tamper, not a tolerated subset.
  const missing = Object.keys(FILLERS).filter((file) => !files.includes(file));
  if (missing.length > 0) {
    throw new Error(
      labEnabled
        ? `lab public pilot tree is missing pinned fillers: ${missing.join(', ')}`
        : `non-lab public pilot tree is missing pinned fillers: ${missing.join(', ')}`
    );
  }
}

// Runtime public-dir resolution, shared by the build gate (next.config.ts)
// and the boot gate (instrumentation.ts): both must inspect the SAME
// tree. The build gate anchors to the config file; the boot gate cannot
// (it has no config-relative anchor at runtime), so the config stashes
// its resolved root in the environment it shares with the boot process.
// Standalone boots may reuse serialized config without evaluating
// next.config.ts: there the server script's own directory is Next's app
// root, detected via Next's standalone marker. Plain cwd is the last
// resort (today's behavior): right whenever the server starts in its app
// directory. Residual: a custom server with an inline conf object and a
// cwd outside the app dir defeats every anchor — that boot keeps the
// legacy cwd check.
export function resolveRoutePublicDir(): string {
  // Request-path twin of resolvePilotPublicDir below: the build/boot
  // gate inspects the tree stashed in BACI_PILOT_PUBLIC_DIR while the
  // lab routes historically read BACI_IMAGE_PILOT_PUBLIC_DIR. When both
  // are set they must resolve to the SAME tree, or the gate and the
  // request verifier inspect different directories (one passing while
  // the other serves different bytes). Explicit route var wins; the
  // fallback is the same standalone-aware resolution the gate uses
  // (stashed root, else the tree beside the standalone server, else
  // cwd/public) — never a bare cwd/public that would diverge from the
  // gate on a standalone cold start. Empty counts as unset everywhere,
  // so '' never resolves '__pilot' against ''.
  const explicit = process.env.BACI_IMAGE_PILOT_PUBLIC_DIR || null;
  // The fallback is the same standalone-aware resolution the gate uses;
  // the agreement check only runs against an ANCHORED gate root
  // (stashed or standalone-server-anchored). A bare cwd/public legacy
  // fallback is not a verified tree, so an explicit route var without
  // any gate root stays trusted (the lab dev flow), as before.
  const gateRoot = gateVerifiedRoot();
  if (
    explicit &&
    gateRoot &&
    canonicalDir(explicit) !== canonicalDir(gateRoot)
  ) {
    throw new Error(
      'merchant image pilot: BACI_IMAGE_PILOT_PUBLIC_DIR disagrees with the build-gate public dir; refusing to serve from an unverified tree'
    );
  }
  return explicit || gateRoot || join(process.cwd(), 'public');
}

// Canonical spelling for tree-identity comparison: lexical resolve()
// treats a symlinked ancestor (/var/...) and its physical spelling
// (/private/var/...) as different trees. Missing paths fall back to
// lexical (nothing to canonicalize yet).
function canonicalDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

// The gate's anchored public root, shared by the gate and the route
// resolver so both sides agree: the stashed verified tree, else the
// tree beside the standalone server. Null when neither anchors — the
// legacy cwd/public fallback is not an anchored root.
function gateVerifiedRoot(): string | null {
  const stashed = process.env.BACI_PILOT_PUBLIC_DIR;
  if (stashed) {
    return stashed;
  }
  if (process.env.__NEXT_PRIVATE_STANDALONE_CONFIG && process.argv[1]) {
    // resolve: argv[1] may be invoked relative; the gate needs absolute.
    return join(dirname(resolve(process.argv[1])), 'public');
  }
  return null;
}

export function resolvePilotPublicDir(): string {
  return gateVerifiedRoot() ?? join(process.cwd(), 'public');
}

export function assertPilotPublicAssets(
  publicDir: string,
  labEnabled = isPilotLabEnabled()
): void {
  const root = join(publicDir, '__pilot');
  if (!directoryExists(root)) {
    // The sawFillers check below only runs when the root exists: an
    // absent root must fail lab startup too, or deleting the whole tree
    // bypasses the filler requirement the previous fix just added.
    if (labEnabled) {
      throw new Error(
        'lab public pilot tree is missing the pilot root directory'
      );
    }
    return;
  }
  let sawFillers = false;
  for (const name of readdirSync(root)) {
    // The approved filler set is hash-pinned in BOTH modes: a stale or
    // locally replaced filler in lab mode would otherwise pass startup
    // and compete unreviewed in the measurement while every gate that
    // compares against the same local file reports green.
    if (name === 'fillers') {
      assertFillers(join(root, name), labEnabled);
      sawFillers = true;
      continue;
    }
    // Lab staging is generation directories (content-derived 64-hex ids)
    // plus the originals set; anything else is refused even in lab mode.
    // The name alone never suffices: a stale or planted symlink with a
    // managed name would otherwise pass the guard and expose its
    // external target through the static /__pilot/... namespace, so
    // every accepted entry is lstat + realpath confined beneath root.
    if (labEnabled && (name === 'originals' || /^[0-9a-f]{64}$/.test(name))) {
      assertConfinedEntry(root, name);
      continue;
    }
    throw new Error(
      'staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1; use a clean public tree for non-lab builds/starts'
    );
  }
  // Lab mode additionally requires the fillers directory itself: the
  // grid renders all three sibling-card images, so an absent directory
  // (packaging omission, local deletion) must fail startup, not serve
  // broken images into the comparison.
  if (labEnabled && !sawFillers) {
    throw new Error('lab public pilot tree is missing the fillers directory');
  }
}
