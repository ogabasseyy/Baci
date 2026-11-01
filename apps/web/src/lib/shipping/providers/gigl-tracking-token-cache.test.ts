import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
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

describe('GIGL tracking token cache', () => {
  it('reuses a token in another invocation using private permissions', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    const later = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now + 1_000,
    });
    expect(await later.load()).toEqual(token);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(directory, 'token.json'))).mode & 0o777).toBe(
      0o600
    );
    expect(await readFile(join(directory, 'token.json'), 'utf8')).not.toContain(
      credentials.password
    );
  });

  it('does not reuse expired tokens or tokens from rotated credentials', async () => {
    const { directory } = await fixture();
    await createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
    }).save(token);
    expect(
      await createGiglTrackingTokenCache({
        directory,
        credentials,
        now: () => token.expiresAt,
      }).load()
    ).toBeNull();
    expect(
      await createGiglTrackingTokenCache({
        directory,
        credentials: { ...credentials, password: 'rotated' },
        now: () => now,
      }).load()
    ).toBeNull();
  });

  it.each([
    -1, 1.5,
  ])('preserves a finite provider customer type %s', async (customerType) => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
    });
    const value = { ...token, customerType };
    await cache.save(value);
    expect(await cache.load()).toEqual(value);
  });

  it('refuses a symlink cache file without changing its target', async () => {
    const { directory, root } = await fixture();
    const cache = createGiglTrackingTokenCache({
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

  it('does not use a symlink as the cache directory', async () => {
    const { root, directory } = await fixture();
    const target = join(root, 'other');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, directory);
    const cache = createGiglTrackingTokenCache({
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
      directory: join(parent, 'cache'),
      credentials,
      now: () => now,
    });
    await expect(cache.save(token)).rejects.toThrow();
  });

  it('clears only the cached token', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    await cache.clear();
    expect(await cache.load()).toBeNull();
  });
});
