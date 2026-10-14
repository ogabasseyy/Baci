import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

// Bounds allocation even if an operator file grows after opening it.
export async function readBoundedLabJson(
  path: string,
  budget: number
): Promise<string> {
  // Refuse a symlinked leaf without following it: the generation dir
  // is realpath-confined before this read, but a manifest.json symlink
  // would still escape the output tree to an operator file elsewhere.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(budget + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > budget)
      throw new Error('merchant image pilot: JSON exceeds byte budget');
    return buffer.subarray(0, offset).toString('utf8');
  } finally {
    await handle.close();
  }
}
