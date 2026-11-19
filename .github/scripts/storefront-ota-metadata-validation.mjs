import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function validateExportMetadata(directory, sourceSha) {
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new Error('Source revision must be a full Git commit SHA.');
  }
  const metadata = JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8'));
  const ios = metadata.fileMetadata?.ios;
  if (!ios || Object.keys(metadata.fileMetadata).length !== 1 || !Array.isArray(ios.assets)) {
    throw new Error('Export must contain an iOS bundle and no other platform.');
  }
  async function readExportFile(relativePath) {
    if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) {
      throw new Error('Export metadata has an invalid file path.');
    }
    const resolved = path.resolve(directory, relativePath);
    if (!resolved.startsWith(`${path.resolve(directory)}${path.sep}`)) {
      throw new Error('Export metadata references a file outside the export.');
    }
    const stat = await lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('Export metadata references a non-regular file.');
    }
    return readFile(resolved);
  }
  const bundle = await readExportFile(ios.bundle);
  if (!bundle.includes(sourceSha)) {
    throw new Error('Bundle revision does not match the selected source revision.');
  }
  try {
    await readExportFile(`${ios.bundle}.map`);
  } catch {
    throw new Error('Export is missing a readable bundle source map.');
  }
  for (const asset of ios.assets) {
    await readExportFile(asset.path);
  }
}
