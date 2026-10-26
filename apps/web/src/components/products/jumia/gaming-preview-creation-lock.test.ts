import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireGamingPreviewCreationLock } from './gaming-preview-creation-lock';

const originalLocks = navigator.locks;

afterEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: originalLocks,
  });
});

describe('acquireGamingPreviewCreationLock', () => {
  it('requests an exclusive no-wait lock scoped to the merchant', async () => {
    const request = vi.fn(
      async (
        _name: string,
        _options: unknown,
        callback: (lock: Lock | null) => Promise<void>
      ) => callback({ name: 'lock', mode: 'exclusive' } as Lock)
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request } as unknown as LockManager,
    });

    const release = await acquireGamingPreviewCreationLock('merchant-1');

    expect(release).toEqual(expect.any(Function));
    expect(request).toHaveBeenCalledWith(
      'jumia-gaming-preview-create:merchant-1',
      { mode: 'exclusive', ifAvailable: true },
      expect.any(Function)
    );
    release?.();
  });

  it('returns null when another tab holds the lock', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          _name: string,
          _options: unknown,
          callback: (lock: null) => void
        ) => callback(null),
      } as unknown as LockManager,
    });

    await expect(
      acquireGamingPreviewCreationLock('merchant-busy')
    ).resolves.toBeNull();
  });

  it('keeps the exclusive lock until creation finishes, then releases it', async () => {
    const held = new Set<string>();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: unknown,
          callback: (lock: Lock | null) => Promise<void>
        ) => {
          if (held.has(name)) return callback(null);
          held.add(name);
          try {
            return await callback({ name, mode: 'exclusive' } as Lock);
          } finally {
            held.delete(name);
          }
        },
      } as unknown as LockManager,
    });

    const release = await acquireGamingPreviewCreationLock('merchant-shared');
    await expect(
      acquireGamingPreviewCreationLock('merchant-shared')
    ).resolves.toBeNull();
    release?.();
    await Promise.resolve();
    await Promise.resolve();
    const reacquired =
      await acquireGamingPreviewCreationLock('merchant-shared');
    expect(reacquired).toEqual(expect.any(Function));
    reacquired?.();
  });

  it('fails closed when Web Locks are unavailable', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: undefined,
    });

    await expect(
      acquireGamingPreviewCreationLock('merchant-unsupported')
    ).rejects.toThrow(/cannot safely coordinate/i);
  });
});
