import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { BRILSTASH_JSON_MAX_BYTES } from '../../config/brilstash-feed';

async function readInputFile(path: string): Promise<unknown> {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > BRILSTASH_JSON_MAX_BYTES)
      throw new Error('Invalid input size');

    // The file can grow after stat. Read at most one byte past the limit.
    const contents = Buffer.alloc(BRILSTASH_JSON_MAX_BYTES + 1);
    let bytes = 0;
    while (bytes < contents.length) {
      const { bytesRead } = await file.read(
        contents,
        bytes,
        contents.length - bytes,
        bytes
      );
      if (bytesRead === 0) break;
      bytes += bytesRead;
    }
    if (bytes > BRILSTASH_JSON_MAX_BYTES) throw new Error('Invalid input size');
    return JSON.parse(contents.toString('utf8', 0, bytes));
  } finally {
    await file.close();
  }
}

export async function readBrilStashCliInput(args: string[]) {
  const [inputFile, applyFlag] = args;
  if (
    !inputFile ||
    inputFile.startsWith('-') ||
    args.length > 2 ||
    (applyFlag !== undefined && applyFlag !== '--apply')
  ) {
    throw new Error('Expected an input JSON file followed by optional --apply');
  }

  let input: unknown;
  try {
    input = await readInputFile(inputFile);
  } catch {
    throw new Error('Unable to read BrilStash input file');
  }
  return { input, apply: applyFlag === '--apply' };
}
