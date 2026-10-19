import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';

export async function verifyHostedSavingsResetFile(expected: {path: string; bytes: number; sha256: string}) {
  const metadata = await lstat(expected.path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0 || await realpath(expected.path) !== expected.path)
    throw new Error('Backup must be a private regular nonsymlink file');
  const file = await open(expected.path, 'r');
  try {
    const before = await file.stat();
    if (before.ino !== metadata.ino || before.dev !== metadata.dev || before.size !== expected.bytes || before.size > 2_000_000)
      throw new Error('Backup identity or size mismatch');
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    if (hash.digest('hex') !== expected.sha256 || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('Backup hash or stability mismatch');
  } finally { await file.close(); }
}
