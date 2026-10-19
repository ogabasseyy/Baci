import 'server-only';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';

// Creates a staging directory confined under the public dir, lstat-validating
// each level (never following links) so a planted symlink rejects with no
// out-of-tree changes. Returns the canonical dir for per-file confinement.
export async function ensureStageDir(
  publicDir: string,
  ...segments: string[]
): Promise<string> {
  const escapes = () =>
    new Error('merchant image pilot: staging directory escapes the public dir');
  const inaccessible = () =>
    new Error('merchant image pilot: staged public dir is not accessible');
  for (const segment of segments) {
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes(sep)
    ) {
      throw escapes();
    }
  }
  // Anchor first: traverses only at-or-above the public dir.
  await mkdir(publicDir, { recursive: true }).catch(() => {
    throw inaccessible();
  });
  const levels = [publicDir];
  for (const segment of segments) {
    levels.push(join(levels[levels.length - 1] as string, segment));
  }
  for (const level of levels) {
    const existing = await lstat(level).catch(() => null);
    if (!existing) {
      await mkdir(level).catch(() => {
        throw inaccessible();
      });
    }
    const stat = existing ?? (await lstat(level).catch(() => null));
    if (!stat || stat.isSymbolicLink()) {
      throw escapes();
    }
    if (!stat.isDirectory()) {
      throw inaccessible();
    }
  }
  const realPublic = await realpath(publicDir);
  const real = await realpath(join(publicDir, ...segments));
  if (real !== realPublic && !real.startsWith(realPublic + sep)) {
    throw escapes();
  }
  return real;
}
