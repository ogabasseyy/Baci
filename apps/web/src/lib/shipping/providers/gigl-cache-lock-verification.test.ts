import { afterEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  fstatSync: vi.fn(),
  lstatSync: vi.fn(),
  readFileSync: vi.fn(),
  readSync: vi.fn(),
}));
vi.mock('node:fs', async () => {
  const original = (await vi.importActual(
    'node:fs'
  )) as typeof import('node:fs');
  return { ...original, ...fs, default: { ...original, ...fs } };
});
vi.mock('node:worker_threads', async () => {
  const original = (await vi.importActual(
    'node:worker_threads'
  )) as typeof import('node:worker_threads');
  return {
    ...original,
    isMainThread: true,
    default: { ...original, isMainThread: true },
  };
});

import { hasVerifiedGiglCacheLock } from './gigl-cache-lock-verification';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function mockOwnedLock() {
  const fakeProcess = Object.create(process) as NodeJS.Process;
  Object.defineProperties(fakeProcess, {
    platform: { value: 'linux' },
    pid: { value: 1234 },
    getuid: { value: () => 501 },
  });
  vi.stubGlobal('process', fakeProcess);
  const directory = {
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: 501,
    mode: 0o700,
  };
  const file = {
    isFile: () => true,
    isSymbolicLink: () => false,
    uid: 501,
    mode: 0o600,
    nlink: 1,
    dev: 3,
    ino: 4,
  };
  fs.lstatSync.mockImplementation((path: string) =>
    path.endsWith('cache.lock') ? file : directory
  );
  fs.fstatSync.mockReturnValue(file);
  fs.readSync.mockImplementation((_fd, buffer: Buffer) =>
    buffer.write('1234\n')
  );
  fs.readFileSync.mockReturnValue('lock:\t1: FLOCK ADVISORY WRITE 1234');
}

describe('GIGL cache lock verification', () => {
  it('accepts a private lock held by the current worker', () => {
    mockOwnedLock();
    const result = hasVerifiedGiglCacheLock('/private/cache', 9);
    expect(fs.lstatSync).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('fails closed when the descriptor lacks the flock', () => {
    mockOwnedLock();
    fs.readFileSync.mockReturnValue('');
    expect(hasVerifiedGiglCacheLock('/private/cache', 9)).toBe(false);
  });

  it('rejects a descriptor referring to a different inode', () => {
    mockOwnedLock();
    fs.fstatSync.mockReturnValue({ isFile: () => true, dev: 3, ino: 5 });
    expect(hasVerifiedGiglCacheLock('/private/cache', 9)).toBe(false);
  });
});
