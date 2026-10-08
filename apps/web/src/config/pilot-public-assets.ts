import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

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
      confined(childPath);
      if (childStat.isDirectory()) {
        pending.push(childPath);
      }
    }
  }
}

function assertFillers(fillersDir: string, labEnabled: boolean): void {
  directoryExists(fillersDir);
  const files = readdirSync(fillersDir);
  for (const file of files) {
    const expected = FILLERS[file];
    const path = join(fillersDir, file);
    const stat = lstatSync(path);
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
  if (labEnabled) {
    // The store grid always references all three filler URLs: a subset
    // of valid files would still start the lab with broken
    // sibling-card images and contaminate the comparison, so lab mode
    // requires the exact complete set after every present file checks.
    const missing = Object.keys(FILLERS).filter(
      (file) => !files.includes(file)
    );
    if (missing.length > 0) {
      throw new Error(
        `lab public pilot tree is missing pinned fillers: ${missing.join(', ')}`
      );
    }
  }
}

export function assertPilotPublicAssets(
  publicDir: string,
  labEnabled = process.env.BACI_IMAGE_PILOT_LAB === '1'
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
