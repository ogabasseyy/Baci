import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './storefront-ota-sha256.mjs';

export async function collectExportDigests(directory) {
  const files = {};
  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const filePath = path.join(currentDirectory, entry.name);
      const relative = path.relative(directory, filePath).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error('Export contains a symbolic link.');
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && relative !== 'provenance.json') {
        files[relative] = sha256(await readFile(filePath));
      }
    }
  }
  await visit(directory);
  return files;
}
