import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('loads a complete record when file reads return short chunks', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
      isLocked: () => true,
    });
    await cache.save(token);
    const probe = await open(join(directory, 'token.json'), 'r');
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalRead = prototype.read;
    const spy = vi.spyOn(prototype, 'read').mockImplementation(function (
      this: unknown,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number
    ) {
      return originalRead.call(
        this,
        buffer,
        offset,
        Math.min(length, 7),
        position
      );
    });
    try {
      expect(await cache.load()).toEqual(token);
    } finally {
      spy.mockRestore();
    }
  });
  it('does not replace a usable cached token when syncing the new file fails', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    const probe = await open(join(directory, 'token.json'), 'r');
    const prototype = Object.getPrototypeOf(probe) as {
      sync: () => Promise<void>;
    };
    await probe.close();
    const sync = vi
      .spyOn(prototype, 'sync')
      .mockRejectedValueOnce(new Error('synthetic sync failure'));
    try {
      await expect(
        cache.save({ ...token, token: 'new-token' })
      ).rejects.toThrow('synthetic sync failure');
      expect(await cache.load()).toEqual(token);
    } finally {
      sync.mockRestore();
    }
  });
  it('refuses reads, writes and deletion without a held worker lock', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => false,
      directory,
      credentials,
      now: () => now,
    });
    expect(await cache.load()).toBeNull();
    await expect(cache.save(token)).rejects.toThrow('Cache lock unavailable');
    await expect(cache.clear()).rejects.toThrow('Cache lock unavailable');
  });

  it('does not publish a token if the lock is lost while encrypting', async () => {
    const { directory } = await fixture();
    let checks = 0;
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
      isLocked: () => ++checks === 1,
    });
    await expect(cache.save(token)).rejects.toThrow('Cache lock unavailable');
    await expect(stat(join(directory, 'token.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('reuses a token in another invocation using private permissions', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    const later = createGiglTrackingTokenCache({
      isLocked: () => true,
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
    const stored = await readFile(join(directory, 'token.json'), 'utf8');
    expect(stored).not.toContain(token.token);
    expect(JSON.parse(stored)).not.toHaveProperty('fingerprint');
  });

  it('rejects a modified encrypted record', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    const path = join(directory, 'token.json');
    const record = JSON.parse(await readFile(path, 'utf8'));
    record.tag = `${record.tag[0] === '0' ? '1' : '0'}${record.tag.slice(1)}`;
    await writeFile(path, JSON.stringify(record));
    expect(await cache.load()).toBeNull();
  });

  it('invalidates the legacy plaintext format without reusing its token', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await cache.save(token);
    const path = join(directory, 'token.json');
    await writeFile(
      path,
      JSON.stringify({ fingerprint: 'a'.repeat(64), token })
    );
    expect(await cache.load()).toBeNull();
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await cache.save(token);
    expect(await cache.load()).toEqual(token);
  });

  it('round-trips the largest supported token and channel', async () => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    const largest = {
      ...token,
      token: '\u0001'.repeat(8192),
      userChannelCode: '\u0001'.repeat(256),
    };
    await cache.save(largest);
    expect(await cache.load()).toEqual(largest);
  });

  it('does not reuse expired tokens or tokens from rotated credentials', async () => {
    const { directory } = await fixture();
    await createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    }).save(token);
    expect(
      await createGiglTrackingTokenCache({
        isLocked: () => true,
        directory,
        credentials,
        now: () => token.expiresAt,
      }).load()
    ).toBeNull();
    expect(
      await createGiglTrackingTokenCache({
        isLocked: () => true,
        directory,
        credentials: { ...credentials, password: 'rotated' },
        now: () => now,
      }).load()
    ).toBeNull();
  });

  it('does not resurrect an old token when credentials rotate back after a cache miss', async () => {
    const { directory } = await fixture();
    const original = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await original.save(token);
    const rotated = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials: { ...credentials, password: 'rotated' },
      now: () => now,
    });
    expect(await rotated.load()).toBeNull();
    expect(await original.load()).toBeNull();
  });

  it('requires the worker parent to exist before bootstrapping its private cache', async () => {
    const { root } = await fixture();
    const workerParent = join(root, 'baci-workers');
    const directory = join(workerParent, 'gigl-tracking-token-cache');
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    await expect(cache.save(token)).rejects.toThrow();
    await mkdir(workerParent, { mode: 0o700 });
    await cache.save(token);
    expect(await cache.load()).toEqual(token);
  });

  it.each([
    -1, 1.5,
  ])('preserves a finite provider customer type %s', async (customerType) => {
    const { directory } = await fixture();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
    });
    const value = { ...token, customerType };
    await cache.save(value);
    expect(await cache.load()).toEqual(value);
  });
});
