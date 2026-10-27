import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CookieLockHarness } from './cart-cross-tab-lock.test-support';

const original = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: new CookieLockHarness(),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (original) Object.defineProperty(navigator, 'locks', original);
  else Reflect.deleteProperty(navigator, 'locks');
});
it('keeps another merchant epoch and generation unchanged on retirement', async () => {
  const lock = await import('./cart-cross-tab-lock');
  const storage = await import('./shared-cart-storage');
  const before = lock.getCartCookieEpoch('other');
  const generation = storage.getCartSessionGeneration('other');
  const retirement = lock.beginCartCookieRetirement(1000, undefined, 'shop');
  await retirement.drained;
  const key = 'baci-cart-authority-epoch:shop';
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue: localStorage.getItem(key) })
  );
  expect(lock.isCartCookieEpochCurrent(before, 'other')).toBe(true);
  expect(storage.getCartSessionGeneration('other')).toBe(generation);
  retirement.release();
});
it('rejects another realm writer when epoch storage is write-denied', async () => {
  const first = await import('./cart-session-write-fence');
  vi.resetModules();
  const second = await import('./cart-session-write-fence');
  const denied = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
  const retirement = first.beginCartSessionRetirement('shop');
  await expect(retirement.drained).rejects.toThrow();
  retirement.release();
  const operation = vi.fn().mockResolvedValue(true);
  await expect(
    second.runBoundedCartSessionWrite('shop', false, operation)
  ).resolves.toBe(false);
  expect(operation).not.toHaveBeenCalled();
  denied.mockRestore();
});
it('preserves a queued other-merchant writer across retirement', async () => {
  const lock = await import('./cart-cross-tab-lock');
  const retirement = lock.beginCartCookieRetirement(1000, undefined, 'shop');
  await retirement.drained;
  const operation = vi.fn().mockResolvedValue('other-cart');
  const queued = lock.withCartCookieWrite(
    'blocked',
    new AbortController().signal,
    operation,
    'other'
  );
  retirement.release();
  await expect(queued).resolves.toBe('other-cart');
  expect(operation).toHaveBeenCalledOnce();
});
