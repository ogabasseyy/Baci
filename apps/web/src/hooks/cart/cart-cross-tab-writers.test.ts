import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CookieLockHarness } from './cart-cross-tab-lock.test-support';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalSecure = Object.getOwnPropertyDescriptor(
  window,
  'isSecureContext'
);
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
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
  vi.useRealTimers();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
  if (originalSecure)
    Object.defineProperty(window, 'isSecureContext', originalSecure);
  else Reflect.deleteProperty(window, 'isSecureContext');
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
it('serializes cookie writers from distinct browser tabs', async () => {
  vi.resetModules();
  const first = await import('./cart-session-write-fence');
  vi.resetModules();
  const second = await import('./cart-session-write-fence');
  let finish!: (value: string) => void;
  const pending = first.runBoundedCartSessionWrite(
    'shop',
    'blocked',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await tick();
  const next = vi.fn().mockResolvedValue('second-cookie');
  const queued = second.runBoundedCartSessionWrite('shop', 'blocked', next);
  await tick();
  expect(next).not.toHaveBeenCalled();
  finish('first-cookie');
  await pending;
  await expect(queued).resolves.toBe('second-cookie');
  expect(next).toHaveBeenCalledOnce();
});
it('queues de-enrollment revocation behind an active local writer', async () => {
  vi.resetModules();
  const writer = await import('./cart-session-write-fence');
  const revoke = await import('./shared-cart-session-revoke-client');
  const { fetchWithCsrf } = await import('@/lib/api-client');
  vi.mocked(fetchWithCsrf).mockResolvedValue(Response.json({ revoked: true }));
  let finish!: (value: string) => void;
  const pending = writer.runBoundedCartSessionWrite(
    'shop',
    'blocked',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await tick();
  revoke.retireDeEnrolledCartDeviceSession('shop', {
    hasCartId: true,
    hasImportReceipt: false,
  });
  await tick();
  expect(fetchWithCsrf).not.toHaveBeenCalled();
  finish('cookie-installed');
  await pending;
  await tick();
  await tick();
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    expect.stringContaining('/revoke'),
    expect.anything()
  );
});
it('publishes an immediate local relink after an indeterminate transition', async () => {
  const { runCartSessionTransition } = await import(
    './cart-session-write-fence'
  );
  const { getCartSessionGeneration, getCartSessionGenerationChange } =
    await import('./shared-cart-storage');
  const before = getCartSessionGeneration();
  await expect(
    runCartSessionTransition('shop', false, async () => false, {
      isSuccessful: Boolean,
      operationId: 'selection',
    })
  ).resolves.toBe(false);
  expect(getCartSessionGeneration()).toBe(before + 1);
  expect(getCartSessionGenerationChange()).toMatchObject({
    from: before,
    transition: { merchantSlug: 'shop', operationId: 'selection' },
  });
});
