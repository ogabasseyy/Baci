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

export async function readRawArtifact(
  nextDir: string,
  identifier: string
): Promise<string> {
  const candidates = [
    `server/app/${identifier}.html`,
    `server/app/${identifier}/page.html`,
    `server/app/${identifier}/index.html`,
  ];
  for (const candidate of candidates) {
    try {
      return (await readArtifactFile(nextDir, candidate)).toString('utf8');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      )
        continue;
      throw error;
    }
  }
  throw new Error(`${identifier} raw route artifact was not found`);
}
