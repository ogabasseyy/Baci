import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function present(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function assertNoPrivateValues(directory, values) {
  const secrets = Object.entries(values).map(([name, value]) => {
    if (!present(value)) throw new Error(`Missing build-only secret ${name} for scanning.`);
    return [name, Buffer.from(value.trim())];
  });
  for (const [name, value] of secrets) {
    if (value.length < 8) throw new Error(`Cannot scan short secret ${name}.`);
  }

  async function scan(currentDirectory) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Export contains a symbolic link.');
      if (entry.isDirectory()) {
        await scan(entryPath);
      } else if (entry.isFile()) {
        const contents = await readFile(entryPath);
        for (const [name, value] of secrets) {
          if (contents.includes(value)) {
            throw new Error(`Export contains build-only secret ${name}.`);
          }
        }
      }
    }
  }
  await scan(directory);
}
