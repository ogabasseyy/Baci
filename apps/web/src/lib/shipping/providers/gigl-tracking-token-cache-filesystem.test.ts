import { spawnSync } from 'node:child_process';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
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

describe('GIGL tracking token cache filesystem safety', () => {
  it('removes only owned private orphaned temporary files under the lock', async () => {
    const { directory, root } = await fixture();
    await mkdir(directory, { mode: 0o700 });
    const orphan = join(directory, '.11111111-1111-4111-8111-111111111111.tmp');
    const unsafe = join(directory, '.22222222-2222-4222-8222-222222222222.tmp');
    const linkPath = join(
      directory,
      '.33333333-3333-4333-8333-333333333333.tmp'
    );
    const target = join(root, 'target');
    await writeFile(orphan, 'ciphertext', { mode: 0o600 });
    await writeFile(unsafe, 'preserve', { mode: 0o644 });
    await chmod(unsafe, 0o644);
    await writeFile(target, 'untouched');
    await symlink(target, linkPath);
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
      isLocked: () => true,
    });
    await cache.save(token);
    await expect(lstat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(unsafe, 'utf8')).toBe('preserve');
    expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, 'utf8')).toBe('untouched');
  });

  it('does not remove an orphan if the worker lock is lost', async () => {
    const { directory } = await fixture();
    await mkdir(directory, { mode: 0o700 });
    const orphan = join(directory, '.11111111-1111-4111-8111-111111111111.tmp');
    await writeFile(orphan, 'ciphertext', { mode: 0o600 });
    let checks = 0;
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
      isLocked: () => ++checks === 1,
    });
    await expect(cache.save(token)).rejects.toThrow('Cache lock unavailable');
    expect(await readFile(orphan, 'utf8')).toBe('ciphertext');
  });
  it('does not report a normal first-run cache miss as a failure', async () => {
    const { directory } = await fixture();
    const onUnavailable = vi.fn();
    await mkdir(directory, { mode: 0o700 });
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
      onUnavailable,
    });
    expect(await cache.load()).toBeNull();
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  it('reports a missing cache directory after the worker lock is acquired', async () => {
    const { directory } = await fixture();
    const onUnavailable = vi.fn();
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
      onUnavailable,
    });
    expect(await cache.load()).toBeNull();
    expect(onUnavailable).toHaveBeenCalledOnce();
  });
  it('reports a lost worker lock instead of treating it as a normal missing file', async () => {
    const { directory } = await fixture();
    await mkdir(directory, { mode: 0o700 });
    const onUnavailable = vi.fn();
    const isLocked = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const cache = createGiglTrackingTokenCache({
      directory,
      credentials,
      now: () => now,
      isLocked,
      onUnavailable,
    });
    expect(await cache.load()).toBeNull();
    expect(onUnavailable).toHaveBeenCalledOnce();
  });
  it('returns a cache miss promptly when token.json is a FIFO', async () => {
    const { directory } = await fixture();
    await mkdir(directory, { mode: 0o700 });
    const path = join(directory, 'token.json');
    expect(spawnSync('mkfifo', ['-m', '600', path]).status).toBe(0);
    const script = `
      import { createGiglTrackingTokenCache } from './src/lib/shipping/providers/gigl-tracking-token-cache.ts';
      const cache = createGiglTrackingTokenCache({
        isLocked: () => true, directory: process.argv[1],
        credentials: { baseUrl: 'https://example.test', email: 'test@example.test', password: 'test' },
        now: () => 1800000000000,
      });
      if (await cache.load() !== null) process.exitCode = 1;
    `;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--conditions',
        'react-server',
        '--input-type=module',
        '-e',
        script,
        directory,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 15000 }
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect((await lstat(path)).isFIFO()).toBe(true);
  }, 20000);
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

  it('reports an unsafe cache file even if no token is saved', async () => {
    const { directory } = await fixture();
    const onUnavailable = vi.fn();
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, 'token.json'), 'unsafe', { mode: 0o644 });
    await chmod(join(directory, 'token.json'), 0o644);
    const cache = createGiglTrackingTokenCache({
      isLocked: () => true,
      directory,
      credentials,
      now: () => now,
      onUnavailable,
    });
    expect(await cache.load()).toBeNull();
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(onUnavailable).toHaveBeenCalledWith();
    expect(await readFile(join(directory, 'token.json'), 'utf8')).toBe(
      'unsafe'
    );
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
