import 'server-only';

import { createHmac, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import {
  giglTrackingTokenCacheRecordSchema,
  giglTrackingTokenSchema,
} from '@/schemas/gigl-tracking-token-cache';
import type { GiglToken } from './gigl.constants';

const maxLifetime = 20 * 24 * 60 * 60 * 1000;

type Credentials = { baseUrl: string; email: string; password: string };

export function createGiglTrackingTokenCache({
  directory,
  credentials,
  now = Date.now,
}: {
  directory: string;
  credentials: Credentials;
  now?: () => number;
}) {
  const fingerprint = createHmac('sha256', credentials.password)
    .update(JSON.stringify([credentials.baseUrl, credentials.email]))
    .digest('hex');

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

  async function load(): Promise<GiglToken | null> {
    try {
      const file = join(await validateDirectory(false), 'token.json');
      const handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      try {
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          info.uid !== process.getuid?.() ||
          (info.mode & 0o777) !== 0o600 ||
          info.size > 16_384
        )
          return null;
        const buffer = Buffer.alloc(16_385);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 16_384) return null;
        const parsed = giglTrackingTokenCacheRecordSchema.safeParse(
          JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
        );
        if (!parsed.success) return null;
        if (
          parsed.data.fingerprint !== fingerprint ||
          !usable(parsed.data.token)
        ) {
          // Normal worker invocations are serialized by the GIGL tracking lock.
          // Remove a stale record so reverting credentials cannot resurrect it.
          await rm(file, { force: true });
          return null;
        }
        return parsed.data.token;
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  async function save(token: GiglToken): Promise<void> {
    const parsed = giglTrackingTokenSchema.parse(token);
    if (!usable(parsed)) throw new Error('Invalid cached token expiry');
    const resolvedDirectory = await validateDirectory(true);
    const file = join(resolvedDirectory, 'token.json');
    await validateExistingFile(file);
    const temporary = join(resolvedDirectory, `.${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(
        JSON.stringify({ fingerprint, token: parsed }),
        'utf8'
      );
      await handle.close();
      await rename(temporary, file);
    } finally {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true });
    }
  }

  async function clear(): Promise<void> {
    const file = join(await validateDirectory(false), 'token.json');
    await validateExistingFile(file);
    await rm(file, { force: true });
  }

  return { load, save, clear };
}
