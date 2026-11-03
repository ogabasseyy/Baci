import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CookieLockHarness } from './cart-cross-tab-lock.test-support';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalSecure = Object.getOwnPropertyDescriptor(
  window,
  'isSecureContext'
);
beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: new CookieLockHarness(),
  });
});
afterEach(() => {
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  if (originalSecure)
    Object.defineProperty(window, 'isSecureContext', originalSecure);
  else Reflect.deleteProperty(window, 'isSecureContext');
});
it('proceeds in the same call after revocation rotates the epoch', async () => {
  const fence = await import('./cart-session-write-fence');
  window.localStorage.setItem('baci-cart-authority-epoch:shop', 'before');
  const operation = vi.fn().mockResolvedValue('proceeded');
  const result = await fence.runBoundedCartSessionWrite(
    'shop',
    'fallback',
    operation,
    undefined,
    async () => {
      // Revocation clearing acquires retirement, which rotates the epoch.
      window.localStorage.setItem(
        'baci-cart-authority-epoch:shop',
        'after-revocation'
      );
      return true;
    }
  );
  expect(result).toBe('proceeded');
  expect(operation).toHaveBeenCalledOnce();
});
