import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isPilotLabEnabled } from './pilot-lab-enabled';
import {
  assertConfinedEntry,
  assertNonLabEntry,
  assertNonLabFillers,
} from './pilot-public-assets-triage';

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

// Reads one filler through a no-follow descriptor: lstat-then-readFile
// would follow a same-dir replacement (large file, symlink, FIFO)
// swapped in after the check — exhausting memory, hashing
// out-of-tree bytes, or blocking the boot. Every validation reads the
// descriptor whose identity was verified: O_NOFOLLOW refuses links at
// open (ELOOP), O_NONBLOCK keeps a FIFO open from hanging, fstat
// rejects non-files and multi-linked inodes before any read, and the
// read itself is bounded by the verified size. Mid-read growth cannot
// overflow (bounded) and mid-read shrink fails the hash below. Open
// failures surface as the curated unapproved message, never a raw
// path-leaking errno.
function readPinnedFillerBytes(path: string): Buffer {
  let fd: number;
  try {
    fd = openSync(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK
    );
  } catch {
    throw new Error('lab public pilot tree contains an unapproved filler');
  }
  try {
    const stat = fstatSync(fd);
    // A hardlink lets an outside writer mutate the served bytes after
    // the check: same nlink>1 multi-link rejection as the
    // generation/original guard.
    if (stat.nlink > 1) {
      throw new Error('lab public pilot tree contains a hardlinked filler');
    }
    if (!stat.isFile() || stat.size > 2_000_000) {
      throw new Error('lab public pilot tree contains an unapproved filler');
    }
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < stat.size) {
      const read = readSync(fd, bytes, offset, stat.size - offset, null);
      if (read === 0) {
        break;
      }
      offset += read;
    }
    return offset === stat.size ? bytes : bytes.subarray(0, offset);
  } finally {
    closeSync(fd);
  }
}

// Pinned filler entries for request-time re-verification: the lab
// renders these sibling-card images on every page, so a mid-measurement
// edit (landing between control and pilot captures) would corrupt the
// comparison even though merchant bytes still verify. Same {path,
// sha256} shape as stagedPaths, so the shared stat-fingerprint fast
// path covers them (3 lstats per request, re-hash only on drift).
export function pinnedFillerEntries(
  publicDir: string
): { path: string; sha256: string }[] {
  return Object.entries(FILLERS).map(([file, sha256]) => ({
    path: join(publicDir, '__pilot', 'fillers', file),
    sha256,
  }));
}

function assertFillers(fillersDir: string): void {
  // The caller lists this entry, so it existed a moment ago — but a
  // file squatting the name (or a mid-boot deletion) is not the
  // directory: fail with the curated message, not a raw ENOTDIR/ENOENT
  // path leak from the read below.
  if (!directoryExists(fillersDir)) {
    throw new Error('lab public pilot tree is missing the fillers directory');
  }
  const files = readdirSync(fillersDir);
  for (const file of files) {
    const expected = FILLERS[file];
    if (!expected) {
      throw new Error('lab public pilot tree contains an unapproved filler');
    }
    const digest = createHash('sha256')
      .update(readPinnedFillerBytes(join(fillersDir, file)))
      .digest('hex');
    if (digest !== expected) {
      throw new Error('lab public pilot tree contains an unapproved filler');
    }
  }
  // The lab grid references all three filler URLs: a subset would
  // start the lab with broken sibling-card images, so a packaging
  // omission must fail lab startup.
  const missing = Object.keys(FILLERS).filter((file) => !files.includes(file));
  if (missing.length > 0) {
    throw new Error(
      `lab public pilot tree is missing pinned fillers: ${missing.join(', ')}`
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
// root, detected via Next's standalone marker. A custom server with an
// inline conf object and a cwd outside the app dir defeats every
// anchor — that boot fails closed in resolvePilotPublicDir below.
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
  // so '' never resolves '__pilot' against ''. The route resolver keeps
  // a cwd fallback where the gate throws: every lab request re-verifies
  // bindings against this tree (verifyStagedBytes fails on anything but
  // the expected hashes), so a wrong tree fails closed per request
  // instead of passing silently at boot.
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
  // Fail closed, never cwd: the boot gate inspects this tree while Next
  // serves the real app public tree — a server started from another cwd
  // (custom server, process manager) would otherwise inspect an
  // empty/wrong tree and pass while staged files stay servable. Every
  // first-party flow anchors: next dev/build/start evaluate the config
  // in-process (which stashes the root), and standalone boots anchor to
  // the server script. Only a config-less custom server lands here, and
  // that boot must say which tree it serves.
  const anchored = gateVerifiedRoot();
  if (!anchored) {
    throw new Error(
      'merchant image pilot: cannot anchor the public tree for the startup gate (no config-stashed root, no standalone server path); refusing to inspect an unverified cwd/public — start via next dev/start so next.config stashes the root, or set BACI_PILOT_PUBLIC_DIR'
    );
  }
  return anchored;
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
    // Hash pinning is lab-only: non-lab builds/boots triage fillers
    // like any other entry (confinement plus merchant-shape scan, with
    // the pinned fixture names passing unhashed), so a packaging
    // artifact (.DS_Store) or a recompressed filler can never take down
    // an unrelated production boot — while a merchant file or symlink
    // hiding under fillers/ still refuses. Nothing non-lab references
    // filler bytes.
    if (name === 'fillers') {
      if (labEnabled) {
        assertFillers(join(root, name));
      } else {
        assertNonLabFillers(root, name, new Set(Object.keys(FILLERS)));
      }
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
    if (labEnabled) {
      throw new Error(
        'staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1; use a clean public tree for non-lab builds/starts'
      );
    }
    // Non-lab from here: fatal only on staged-merchant shapes or
    // symlink escapes. Empty leftover dirs pass silently (nothing to
    // serve); unrelated strays warn. A lab-only concern must never
    // brick the production storefront's build or boot.
    assertNonLabEntry(root, name);
  }
  // Lab mode additionally requires the fillers directory itself: the
  // grid renders all three sibling-card images, so an absent directory
  // (packaging omission, local deletion) must fail startup, not serve
  // broken images into the comparison.
  if (labEnabled && !sawFillers) {
    throw new Error('lab public pilot tree is missing the fillers directory');
  }
}
