import { open } from 'node:fs/promises';

// Bounds allocation even if an operator file grows after opening it.
export async function readBoundedLabJson(
  path: string,
  budget: number
): Promise<string> {
  const handle = await open(path, 'r');
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
