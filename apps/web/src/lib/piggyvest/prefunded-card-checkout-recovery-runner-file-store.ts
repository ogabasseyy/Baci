import 'server-only';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { prefundedCardCheckoutRecoveryRunnerStateSchemas as schemas } from '@/schemas/prefunded-card-checkout-recovery-runner-state';

function scopeKey(scope: ReturnType<typeof schemas.scope.parse>): string {
  return createHash('sha256').update(JSON.stringify(scope)).digest('hex');
}

export function createPrefundedCardCheckoutRecoveryRunnerFileStore(
  stateDirectory: string
) {
  if (!stateDirectory.startsWith('/'))
    throw new Error('First-card recovery runner unavailable');
  const active = new Map<string, string>();

  async function assertDirectory() {
    const directory = await open(
      stateDirectory,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW
    );
    const stats = await directory.stat();
    await directory.close();
    if (
      !stats.isDirectory() ||
      (stats.mode & 0o7777) !== 0o700 ||
      (typeof process.getuid === 'function' && stats.uid !== process.getuid())
    )
      throw new Error('First-card recovery runner unavailable');
  }

  return {
    async acquire(input: {
      scope: ReturnType<typeof schemas.scope.parse>;
      token: string;
    }) {
      const parsedScope = schemas.scope.parse(input.scope);
      const key = scopeKey(parsedScope);
      await assertDirectory();
      let stored: unknown = null;
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        const path = join(stateDirectory, `${key}.json`);
        handle = await open(
          path,
          fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
        );
        const stats = await handle.stat();
        if (
          !stats.isFile() ||
          (stats.mode & 0o7777) !== 0o600 ||
          stats.nlink !== 1 ||
          stats.size > 4096 ||
          (typeof process.getuid === 'function' &&
            stats.uid !== process.getuid())
        )
          throw new Error('First-card recovery runner unavailable');
        const buffer = Buffer.alloc(4097);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const read = await handle.read(
            buffer,
            bytesRead,
            buffer.length - bytesRead,
            bytesRead
          );
          if (read.bytesRead === 0) break;
          bytesRead += read.bytesRead;
        }
        if (bytesRead > 4096 || bytesRead !== stats.size)
          throw new Error('First-card recovery runner unavailable');
        stored = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            buffer.subarray(0, bytesRead)
          )
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('First-card recovery runner unavailable');
      } finally {
        await handle?.close().catch(() => undefined);
      }
      const checkpoint = schemas.storedCheckpoint.parse(stored);
      if (
        checkpoint &&
        JSON.stringify(checkpoint.scope) !== JSON.stringify(parsedScope)
      )
        throw new Error('First-card recovery runner unavailable');
      active.set(key, input.token);
      return {
        outcome: 'acquired' as const,
        scope: parsedScope,
        token: input.token,
        cursor: checkpoint?.cursor ?? null,
      };
    },
    async commit(input: {
      scope: ReturnType<typeof schemas.scope.parse>;
      token: string;
      cursor: ReturnType<typeof schemas.cursor.parse> | null;
    }) {
      const parsedScope = schemas.scope.parse(input.scope);
      const key = scopeKey(parsedScope);
      if (active.get(key) !== input.token)
        throw new Error('First-card recovery runner unavailable');
      await assertDirectory();
      const contents = JSON.stringify(
        schemas.checkpoint.parse({
          version: 1,
          scope: parsedScope,
          cursor: input.cursor,
        })
      );
      const temporary = join(stateDirectory, `.${key}.${input.token}.tmp`);
      const target = join(stateDirectory, `${key}.json`);
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(temporary, 'wx', 0o600);
        const stats = await handle.stat();
        if (
          !stats.isFile() ||
          (stats.mode & 0o7777) !== 0o600 ||
          stats.nlink !== 1 ||
          (typeof process.getuid === 'function' &&
            stats.uid !== process.getuid())
        )
          throw new Error('First-card recovery runner unavailable');
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, target);
        const directory = await open(stateDirectory, 'r');
        await directory.sync();
        await directory.close();
        active.delete(key);
        return true;
      } catch {
        await handle?.close().catch(() => undefined);
        await unlink(temporary).catch(() => undefined);
        throw new Error('First-card recovery runner unavailable');
      }
    },
  };
}
