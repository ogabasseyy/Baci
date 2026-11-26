import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';
import { assertPrivateDirectory } from './private-directory.ts';

/** Read only a private regular file; never disclose filesystem or parser details. */
export async function readPrivateAuthConfig(path: string): Promise<unknown> {
  try {
    if (!isAbsolute(path) || normalize(path) !== path) throw Error();
    await assertPrivateDirectory(dirname(path));
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o077) !== 0 ||
        stat.nlink !== 1 ||
        stat.size > 65536
      )
        throw Error();
      const bytes = Buffer.alloc(65537);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length > 65536) throw Error();
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(0, length)
        )
      ) as unknown;
    } finally {
      await handle.close();
    }
  } catch {
    throw Error('INVALID_AUTH_CONFIG_FILE');
  }
}
