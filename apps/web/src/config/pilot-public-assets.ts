import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { isPilotLabEnabled } from './pilot-lab-enabled';
import {
  entryGone,
  quarantinePilotEntry,
  type RenameEntryFn,
} from './pilot-public-assets-quarantine';
import {
  assertConfinedEntry,
  assertNonLabEntry,
  assertNonLabFillers,
  readGuardedFillerBytes,
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

// Non-lab runtime quarantine: a staged-merchant or confinement finding
// in the anchored served tree moves beside public/ (never statically
// served) instead of warn-and-serve (exposes merchant bytes) or fatal
// (bricks unrelated boots on a leftover stage). renameSync never
// follows the entry itself, so symlinked entries move as links and
// nested links move un-traversed. Same-filesystem move (beside
// public/, not tmpdir) so EXDEV cannot fail it; a rename failure
// (read-only tree) stays fatal. Only the anchored boot quarantines —
// unanchored candidates pass quarantine=false, since a foreign tree
// may belong to a live lab session elsewhere on the box.
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
      .update(
        readGuardedFillerBytes(join(fillersDir, file), 'lab public pilot tree')
      )
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

export function assertPilotPublicAssets(
  publicDir: string,
  labEnabled = isPilotLabEnabled(),
  // Pinned-filler drift severity in non-lab mode, lab-scoped by the
  // caller (default strict): lab builds refuse (measurement exactness),
  // non-lab builds warn — synthetic fixtures nothing outside the lab
  // references must not brick storefront deploys, and lab boots
  // re-assert exact fillers, so drift never enters a lab run. Runtime
  // boots with pilot intent refuse too (a same-tree build already
  // passed these bytes, so drift means post-build tamper). Drift
  // rethrows past the warn downgrade below.
  fillerDrift: 'throw' | 'warn' = 'throw',
  // Non-lab CONTENT findings (staged-merchant shapes, symlink escapes,
  // stray structure) severity: refused at build/deploy checks,
  // quarantined-and-continued at runtime boots — EXCEPT when the
  // quarantine itself cannot complete (read-only/immutable tree),
  // which refuses with recovery guidance. That refusal is an
  // explicit operator decision, not an accident: staged content on
  // an un-movable tree means the image baked bytes past the build
  // gate, and serving unverified merchant bytes is worse than
  // refusing the boot. Content findings downgrade; drift follows its
  // own lab-scoped severity (see above).
  runtimeFindings: 'throw' | 'warn' = labEnabled ? 'throw' : 'warn',
  // Quarantine the offending entry on a runtime content finding
  // (warn mode only): warn-and-continue alone would serve the bytes,
  // so the entry moves beside public/ before boot continues. Drift
  // never quarantines (fatal tamper signal); callers checking trees
  // they must not mutate pass false.
  quarantine = true,
  // Fault-injection seam for the concurrent-boot race test (same
  // options-bag precedent as publishQualitySheet's fsyncDir):
  // replaces the quarantine rename so the test can fail the move
  // after the winner removed the source. Production callers omit it.
  io?: { renameEntry?: RenameEntryFn }
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
  // Non-lab runtime downgrade: content findings quarantine-and-continue
  // (the build gate is the enforcement point). Lab mode and explicit
  // 'throw' callers run the check directly — identical to before.
  const downgrade = (name: string, check: () => void): void => {
    if (runtimeFindings === 'throw') {
      check();
      return;
    }
    try {
      check();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'PILOT_FILLER_DRIFT') {
        throw error;
      }
      const message = (error as Error).message;
      if (!quarantine) {
        console.warn(
          `merchant image pilot: ${message}; continuing without quarantine (foreign tree) — the build gate refuses this pre-deploy`
        );
        return;
      }
      let target: string;
      try {
        target = quarantinePilotEntry(
          publicDir,
          root,
          name,
          io?.renameEntry ?? renameSync
        );
      } catch (quarantineError) {
        // Concurrent-boot race: two instances booting against the same
        // tree can both observe one offending entry; the loser fails
        // its rename on the already-moved source. The bytes are
        // unserved either way, so a missing source warns and continues
        // instead of bricking a healthy instance — anything still
        // present refuses below.
        if (entryGone(root, name)) {
          console.warn(
            `merchant image pilot: ${message}; entry "${name}" was already quarantined by a concurrent boot — continuing with the tree clean`
          );
          return;
        }
        // Fail-closed and LOUD: the bytes cannot move (read-only or
        // immutable tree) and must not serve, so the boot refuses
        // with recovery guidance instead of warn-and-serving. A stale
        // tree on a read-only mount means the image baked staged
        // content past the build gate — rebuild it clean.
        throw new Error(
          `${message}; automatic quarantine failed (${
            quarantineError instanceof Error
              ? quarantineError.message
              : String(quarantineError)
          }) — refusing to serve unverified bytes; rebuild the image without public/__pilot content or mount a writable tree`
        );
      }
      console.warn(
        `merchant image pilot: ${message}; moved "${name}" to ${target} — continuing with the tree clean; remove the quarantine after investigating or re-stage`
      );
    }
  };
  let sawFillers = false;
  for (const name of readdirSync(root)) {
    // Fillers triage runs in both modes: full hash pinning in lab;
    // non-lab confines plus merchant-shape scans, with the pinned
    // fixture names passing only when their bytes still match. Unlike
    // every other entry, fillers/ NEVER downgrades: it holds COMMITTED
    // fixtures, so any finding here (staged shape, confinement break,
    // drift) refuses without moving anything — quarantining the entry
    // would delete tracked fixtures from the deployment. The lab never
    // stages into fillers/, so a finding is a drift-equivalent tamper
    // signal, not operator-state hygiene (which is what quarantine is
    // for). Strays and partial sets still pass — only findings refuse.
    if (name === 'fillers') {
      if (labEnabled) {
        assertFillers(join(root, name));
      } else {
        assertNonLabFillers(root, name, FILLERS, fillerDrift);
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
    // Non-lab from here: staged-merchant shapes and symlink
    // escapes refuse at build/deploy ('throw') and quarantine-and-
    // continue at runtime — the boot refuses only when quarantine
    // itself fails (read-only tree: explicit operator decision, see
    // the runtimeFindings contract above). Empty leftover dirs pass
    // silently (nothing to serve); unrelated strays warn in every
    // mode.
    downgrade(name, () => assertNonLabEntry(root, name));
  }
  // Lab mode additionally requires the fillers directory itself: the
  // grid renders all three sibling-card images, so an absent directory
  // (packaging omission, local deletion) must fail startup, not serve
  // broken images into the comparison.
  if (labEnabled && !sawFillers) {
    throw new Error('lab public pilot tree is missing the fillers directory');
  }
}
