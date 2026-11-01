import { randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open, rename, rm } from 'node:fs/promises';

export async function writeEvidenceAtomically(
  outputPath: string,
  content: string
): Promise<void> {
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  let ownsTemporaryPath = false;
  let handle: FileHandle | undefined = await open(temporaryPath, 'wx', 0o600);
  ownsTemporaryPath = true;

  try {
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, outputPath);
    ownsTemporaryPath = false;
  } finally {
    try {
      await handle?.close();
    } finally {
      if (ownsTemporaryPath) await rm(temporaryPath, { force: true });
    }
  }
}
