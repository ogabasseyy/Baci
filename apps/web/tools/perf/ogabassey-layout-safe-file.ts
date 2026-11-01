import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readArtifactFile(
  root: string,
  relative: string
): Promise<Buffer> {
  const parts = relative.split('/');
  if (
    !relative ||
    path.isAbsolute(relative) ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid artifact path');
  }
  let current = root;
  if ((await lstat(current)).isSymbolicLink())
    throw new Error('Artifact root is a symlink');
  for (const part of parts) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error('Artifact path contains a symlink');
  }
  return readFile(current);
}
