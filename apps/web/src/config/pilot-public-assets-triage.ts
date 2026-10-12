// Non-lab triage for the merchant image pilot public tree, split out of
// pilot-public-assets.ts under the repo line ceiling: confinement
// walks, staged-shape scans, and the degraded-mode checks. Lab-only
// filler hash pinning stays with the gate; everything here runs in both
// modes or in degraded lab boot.
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
} from 'node:fs';
import { extname, join, sep } from 'node:path';

export function assertConfinedEntry(
  root: string,
  name: string,
  tree = 'lab public pilot tree'
): void {
  const entry = join(root, name);
  const stat = lstatSync(entry);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${tree} entry "${name}" is not a confined directory`);
  }
  const realRoot = realpathSync(root);
  const confined = (candidate: string): void => {
    const realCandidate = realpathSync(candidate);
    if (
      realCandidate !== realRoot &&
      !realCandidate.startsWith(`${realRoot}${sep}`)
    ) {
      throw new Error(`${tree} entry "${name}" escapes the pilot root`);
    }
  };
  confined(entry);
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    for (const child of readdirSync(current)) {
      const childPath = join(current, child);
      const childStat = lstatSync(childPath);
      if (childStat.isSymbolicLink()) {
        throw new Error(`${tree} entry "${name}" contains a symlink`);
      }
      // Hardlinks have no separate target for realpath to expose: a
      // file hardlinked from outside would pass confinement and be
      // served, so every non-directory must be single-linked.
      // Directories always carry extra links (. entries), hence the
      // directory carve-out.
      if (!childStat.isDirectory() && childStat.nlink > 1) {
        throw new Error(`${tree} entry "${name}" contains a hardlinked file`);
      }
      // Next serves every non-directory public entry: a FIFO, socket,
      // or device with one link would pass the checks above and then
      // block (or leak) on GET, so every descendant must be a regular
      // file or a directory.
      if (!childStat.isDirectory() && !childStat.isFile()) {
        throw new Error(`${tree} entry "${name}" contains a special file`);
      }
      confined(childPath);
      if (childStat.isDirectory()) {
        pending.push(childPath);
      }
    }
  }
}

// Suffixes the pilot stages (tiers plus originals, from
// lab-config-stage-read's format map): a non-lab tree holding one of
// these is staged merchant content and refuses. Anything else there is
// stray (OS artifacts, renamed leftovers) and warns. .jpeg rides along
// although staging normalizes to .jpg: a .jpeg in the tree is
// merchant-plausible, so it fails closed too.
const STAGED_MERCHANT_SUFFIXES = new Set([
  '.avif',
  '.gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.svg',
  '.webp',
]);

// Deep merchant-shape scan (names only, no hashing): any staged suffix
// at any depth refuses. lstat never follows links, so symlinked dirs
// are not traversed and loops cannot hang this; nested symlinks are
// refused separately by the confinement walk.
function findStagedMerchantShape(dir: string): string | null {
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      let stat: Stats | undefined;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        pending.push(full);
        continue;
      }
      if (STAGED_MERCHANT_SUFFIXES.has(extname(entry).toLowerCase())) {
        return entry;
      }
    }
  }
  return null;
}

// Non-lab entry triage: staged-merchant shapes and symlink escapes are
// fatal (the safety goal); unrelated strays warn and empty leftover
// dirs pass silently, so a lab-only concern never bricks the
// production storefront's build or boot. Managed and junk dirs share
// the same treatment: a renamed staging tree (originals moved aside,
// not deleted) still refuses.
export function assertNonLabEntry(root: string, name: string): void {
  const full = join(root, name);
  const stat = lstatSync(full);
  if (stat.isSymbolicLink()) {
    throw new Error(
      `non-lab public pilot tree entry "${name}" is a symlink; remove it or stage into a clean tree`
    );
  }
  if (!stat.isDirectory()) {
    if (STAGED_MERCHANT_SUFFIXES.has(extname(name).toLowerCase())) {
      throw new Error(
        'staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1; use a clean public tree for non-lab builds/starts'
      );
    }
    console.warn(
      `non-lab public pilot tree holds stray file "${name}" (no staged-merchant shape); continuing — remove it or ignore`
    );
    return;
  }
  assertConfinedEntry(root, name, 'non-lab public pilot tree');
  const hit = findStagedMerchantShape(full);
  if (hit) {
    throw new Error(
      'staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1; use a clean public tree for non-lab builds/starts'
    );
  }
  let count = 0;
  try {
    count = readdirSync(full).length;
  } catch {
    count = 0;
  }
  // Empty leftover dirs (crashed/old stages) serve nothing: silent.
  if (count > 0) {
    console.warn(
      `non-lab public pilot tree holds ${count} stray file(s) under "${name}" (no staged-merchant shapes); continuing — remove them or ignore`
    );
  }
}

// Non-lab fillers validation: the gate used to skip fillers/ entirely
// outside lab mode, so a staged merchant file copied under fillers/ —
// or a fillers symlink — was publicly servable with no gate noticing.
// Confinement is unconditional (a symlinked fillers dir refuses, in
// both modes); contents triage like any other entry except the pinned
// fixture names pass by exact name WITHOUT hash refusal, so a
// recompressed filler still cannot brick a non-lab boot. Pinned-name
// drift still warns (hash-checked, warn-only): a merchant image
// planted under a trusted filler name would otherwise be served with
// no record anywhere.
export function assertNonLabFillers(
  root: string,
  name: string,
  pinnedFillers: Readonly<Record<string, string>>
): void {
  assertConfinedEntry(root, name, 'non-lab public pilot tree');
  const dir = join(root, name);
  const pinnedNames = new Set(Object.keys(pinnedFillers));
  let strays = 0;
  // Top level exempts the pinned fixtures; anything nested is scanned
  // in full (fillers ship flat, so a subdirectory is already stray).
  const pending: { current: string; exempt: boolean }[] = [
    { current: dir, exempt: true },
  ];
  while (pending.length > 0) {
    const { current, exempt } = pending.pop() as {
      current: string;
      exempt: boolean;
    };
    for (const entry of readdirSync(current)) {
      if (exempt && pinnedNames.has(entry)) {
        continue;
      }
      const full = join(current, entry);
      const stat = lstatSync(full);
      if (stat.isDirectory()) {
        pending.push({ current: full, exempt: false });
        strays += 1;
        continue;
      }
      if (STAGED_MERCHANT_SUFFIXES.has(extname(entry).toLowerCase())) {
        throw new Error(
          'staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1; use a clean public tree for non-lab builds/starts'
        );
      }
      strays += 1;
    }
  }
  // Plain read (not the pinned-fd reader): a TOCTOU here only skews a
  // warning, never a safety decision — and warn-only is the point.
  for (const [file, expected] of Object.entries(pinnedFillers)) {
    let digest: string;
    try {
      digest = createHash('sha256')
        .update(readFileSync(join(dir, file)))
        .digest('hex');
    } catch {
      continue;
    }
    if (digest !== expected) {
      console.warn(
        `non-lab public pilot tree filler "${file}" does not match the pinned hash; served as-is — restore it or ignore`
      );
    }
  }
  if (strays > 0) {
    console.warn(
      `non-lab public pilot tree holds ${strays} stray file(s) under "${name}" (no staged-merchant shapes); continuing — remove them or ignore`
    );
  }
}

// Init-failure twin of the inventory binding check: lab runtime
// initialization failed, so no stagedPaths exist to bind against — but
// Next still serves public/__pilot statically. Any entry other than
// the synthetic fillers is unbound servable content and refuses boot;
// a fillers-only (or absent/empty) tree keeps the fail-loud behavior,
// since nothing merchant is served. The shape gate already ran before
// init, so this is a coarse content check, not a re-validation.
export function assertNoUnboundStagedContent(publicDir: string): void {
  const root = join(publicDir, '__pilot');
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  const unbound = entries.filter((entry) => entry !== 'fillers');
  if (unbound.length > 0) {
    throw new Error(
      `merchant image pilot: lab runtime failed to initialize with ${unbound.length} unbound ${unbound.length === 1 ? 'entry' : 'entries'} under __pilot; refusing to serve unverified bytes — fix the initialization error above, re-run pnpm pilot:stage, or remove the staged tree`
    );
  }
}
