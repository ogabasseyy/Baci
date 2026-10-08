import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

function assertFillers(fillersDir: string, labEnabled: boolean): void {
  directoryExists(fillersDir);
  for (const file of readdirSync(fillersDir)) {
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
}

export function assertPilotPublicAssets(
  publicDir: string,
  labEnabled = process.env.BACI_IMAGE_PILOT_LAB === '1'
): void {
  const root = join(publicDir, '__pilot');
  if (!directoryExists(root)) return;
  for (const name of readdirSync(root)) {
    // The approved filler set is hash-pinned in BOTH modes: a stale or
    // locally replaced filler in lab mode would otherwise pass startup
    // and compete unreviewed in the measurement while every gate that
    // compares against the same local file reports green.
    if (name === 'fillers') {
      assertFillers(join(root, name), labEnabled);
      continue;
    }
    // Lab staging is generation directories (content-derived 64-hex ids)
    // plus the originals set; anything else is refused even in lab mode.
    if (labEnabled && (name === 'originals' || /^[0-9a-f]{64}$/.test(name))) {
      continue;
    }
    throw new Error(
      'staged merchant pilot assets require BACI_IMAGE_PILOT_LAB=1; use a clean public tree for non-lab builds/starts'
    );
  }
}
