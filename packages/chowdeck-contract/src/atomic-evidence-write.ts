import { randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open, rename, rm } from 'node:fs/promises';

export async function writeEvidenceAtomically(
  outputPath: string,
  content: string
): Promise<void> {
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  let ownsTemporaryPath = false;
  let failed = false;
  let operationError: unknown;
  let handle: FileHandle | undefined = await open(temporaryPath, 'wx', 0o600);
  ownsTemporaryPath = true;

  try {
    await handle.writeFile(content, { encoding: 'utf8' });
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, outputPath);
    ownsTemporaryPath = false;
  } catch (error) {
    failed = true;
    operationError = error;
  }
  let cleanupFailed = false;
  let cleanupError: unknown;
  try {
    await handle?.close();
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }
  try {
    if (ownsTemporaryPath) await rm(temporaryPath, { force: true });
  } catch (error) {
    if (!cleanupFailed) cleanupError = error;
    cleanupFailed = true;
  }
  if (failed) throw operationError;
  if (cleanupFailed) throw cleanupError;
}
