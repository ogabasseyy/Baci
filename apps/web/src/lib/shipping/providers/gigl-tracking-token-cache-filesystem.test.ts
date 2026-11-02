import { spawnSync } from 'node:child_process';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGiglTrackingTokenCache } from './gigl-tracking-token-cache';

const roots: string[] = [];
const now = 1_800_000_000_000;
const credentials = {
  baseUrl: 'https://example.test',
  email: 'synthetic@example.test',
  password: 'synthetic-password',
};
const token = {
  token: 'synthetic-token',
  userChannelCode: 'channel',
  customerType: 1,
  expiresAt: now + 60_000,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gigl-token-cache-'));
  roots.push(root);
  return { root, directory: join(root, 'cache') };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('GIGL tracking token cache filesystem safety', () => {
  it('returns a cache miss promptly when token.json is a FIFO', async () => {
    const { directory } = await fixture();
    await mkdir(directory, { mode: 0o700 });
    const path = join(directory, 'token.json');
    expect(spawnSync('mkfifo', ['-m', '600', path]).status).toBe(0);
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    const pending = cache.load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        pending,
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), 3000);
        }),
      ]);
      expect(result).toBeNull();
    } finally {
      clearTimeout(timer);
      const fifo = await open(path, 'r+');
      await pending;
      await fifo.close();
    }
  });
  it('refuses a symlink cache file without changing its target', async () => {
    const { directory, root } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    const path = join(directory, 'token.json');
    const target = join(root, 'target');
    await writeFile(target, 'untouched');
    await rm(path);
    await symlink(target, path);
    expect(await cache.load()).toBeNull();
    await expect(cache.save(token)).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('untouched');
  });

  it('refuses a token file with an additional hard link', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    await link(join(directory, 'token.json'), join(directory, 'unexpected'));
    expect(await cache.load()).toBeNull();
    await expect(cache.save(token)).rejects.toThrow('Unsafe token cache file');
  });

  it('does not use a symlink as the cache directory', async () => {
    const { root, directory } = await fixture();
    const target = join(root, 'other');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, directory);
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    expect(await cache.load()).toBeNull();
    await expect(cache.save(token)).rejects.toThrow();
  });

  it('refuses a cache beneath a parent writable by other users', async () => {
    const { root, directory } = await fixture();
    await chmod(root, 0o777);
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await expect(cache.save(token)).rejects.toThrow();
    expect(await cache.load()).toBeNull();
  });

  it('refuses a cache with a writable non-sticky ancestor', async () => {
    const { root } = await fixture();
    const parent = join(root, 'parent');
    await mkdir(parent, { mode: 0o700 });
    await chmod(root, 0o777);
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory: join(parent, 'cache'),
      credentials,
      now: () => now,
    });
    await expect(cache.save(token)).rejects.toThrow();
  });

  it('clears only the cached token', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    await cache.clear();
    expect(await cache.load()).toBeNull();
  });
});
