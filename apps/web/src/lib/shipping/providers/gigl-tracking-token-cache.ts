import 'server-only';

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
  giglTrackingTokenCacheRecordSchema,
  giglTrackingTokenSchema,
} from '@/schemas/gigl-tracking-token-cache';
import type { GiglToken } from './gigl.constants';
import {
  type CacheCredentials,
  decryptGiglToken,
  encryptGiglToken,
} from './gigl-tracking-cache-crypto';

const maxLifetime = 20 * 24 * 60 * 60 * 1000;
const maxRecordBytes = 110_000;

export function createGiglTrackingTokenCache({
  directory,
  credentials,
  now = Date.now,
  isLocked,
  onUnavailable = () => undefined,
}: {
  directory: string;
  credentials: CacheCredentials;
  now?: () => number;
  isLocked: () => boolean;
  onUnavailable?: () => void;
}) {
  async function validateDirectory(create: boolean): Promise<string> {
    if (!isAbsolute(directory)) throw new Error('Unsafe token cache path');
    const parentPath = await realpath(dirname(directory));
    const uid = process.getuid?.();
    if (uid === undefined) throw new Error('Unsupported token cache owner');
    let ancestor = parentPath;
    while (true) {
      const info = await lstat(ancestor);
      const trustedOwner = info.uid === uid || info.uid === 0;
      const writable = (info.mode & 0o022) !== 0;
      const trustedSticky = info.uid === 0 && (info.mode & 0o1000) !== 0;
      if (
        !info.isDirectory() ||
        !trustedOwner ||
        (writable && !trustedSticky)
      ) {
        throw new Error('Unsafe token cache ancestor');
      }
      const next = dirname(ancestor);
      if (next === ancestor) break;
      ancestor = next;
    }
    const resolvedDirectory = join(parentPath, basename(directory));
    if (create) {
      try {
        await mkdir(resolvedDirectory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const info = await lstat(resolvedDirectory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700
    ) {
      throw new Error('Unsafe token cache directory');
    }
    return resolvedDirectory;
  }

  async function validateExistingFile(file: string): Promise<void> {
    try {
      const info = await lstat(file);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== 1 ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o600
      ) {
        throw new Error('Unsafe token cache file');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  function usable(token: GiglToken): boolean {
    return token.expiresAt > now() && token.expiresAt <= now() + maxLifetime;
  }

  async function syncDirectory(path: string): Promise<void> {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async function removeOrphanedTemporaryFiles(path: string): Promise<void> {
    const entries = await opendir(path);
    let examined = 0;
    let removed = false;
    for await (const entry of entries) {
      if (++examined > 1024) break;
      if (
        !/^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/.test(
          entry.name
        )
      )
        continue;
      const file = join(path, entry.name);
      const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!info) continue;
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== 1 ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o777) !== 0o600
      )
        continue;
      if (!isLocked()) throw new Error('Cache lock unavailable');
      await rm(file, { force: true });
      removed = true;
    }
    if (removed) await syncDirectory(path);
  }

  async function load(): Promise<GiglToken | null> {
    if (!isLocked()) {
      onUnavailable();
      return null;
    }
    let resolvedDirectory: string;
    try {
      resolvedDirectory = await validateDirectory(false);
    } catch {
      onUnavailable();
      return null;
    }
    let openingFile = true;
    try {
      const file = join(resolvedDirectory, 'token.json');
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
      openingFile = false;
      try {
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.uid !== process.getuid?.() ||
          (info.mode & 0o777) !== 0o600 ||
          info.size > maxRecordBytes
        ) {
          onUnavailable();
          return null;
        }
        const buffer = Buffer.alloc(maxRecordBytes + 1);
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
          const result = await handle.read(
            buffer,
            bytesRead,
            buffer.length - bytesRead,
            bytesRead
          );
          if (result.bytesRead === 0) break;
          bytesRead += result.bytesRead;
        }
        if (bytesRead > maxRecordBytes) {
          onUnavailable();
          return null;
        }
        let record: unknown;
        try {
          record = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
        } catch {
          // A corrupt private record is a cache miss and should be evicted.
          record = null;
        }
        const parsed = giglTrackingTokenCacheRecordSchema.safeParse(record);
        let token: GiglToken | null = null;
        if (parsed.success) {
          try {
            const result = giglTrackingTokenSchema.safeParse(
              await decryptGiglToken(credentials, parsed.data)
            );
            if (result.success && usable(result.data)) token = result.data;
          } catch {
            // Wrong credentials or a modified ciphertext is a cache miss.
          }
        }
        if (!token) {
          if (!isLocked()) {
            onUnavailable();
            return null;
          }
          await rm(file, { force: true });
          await syncDirectory(dirname(file));
          return null;
        }
        if (!isLocked()) {
          onUnavailable();
          return null;
        }
        return token;
      } finally {
        await handle.close();
      }
    } catch (error) {
      let expectedMiss =
        openingFile && (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (expectedMiss) {
        try {
          expectedMiss =
            isLocked() &&
            (await validateDirectory(false)) === resolvedDirectory;
        } catch {
          expectedMiss = false;
        }
      }
      if (!expectedMiss) onUnavailable();
      return null;
    }
  }

  async function save(token: GiglToken): Promise<void> {
    if (!isLocked()) throw new Error('Cache lock unavailable');
    const parsed = giglTrackingTokenSchema.parse(token);
    if (!usable(parsed)) throw new Error('Invalid cached token expiry');
    const resolvedDirectory = await validateDirectory(true);
    const file = join(resolvedDirectory, 'token.json');
    await validateExistingFile(file);
    await removeOrphanedTemporaryFiles(resolvedDirectory);
    const temporary = join(resolvedDirectory, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify(await encryptGiglToken(credentials, parsed)),
        'utf8'
      );
      await handle.sync();
      await handle.close();
      if (!isLocked()) throw new Error('Cache lock unavailable');
      await rename(temporary, file);
      await syncDirectory(resolvedDirectory);
    } finally {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true });
    }
  }

  async function clear(): Promise<void> {
    if (!isLocked()) throw new Error('Cache lock unavailable');
    const file = join(await validateDirectory(false), 'token.json');
    await validateExistingFile(file);
    if (!isLocked()) throw new Error('Cache lock unavailable');
    await rm(file, { force: true });
    await syncDirectory(dirname(file));
  }

  return { load, save, clear };
}
