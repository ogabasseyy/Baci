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
it('drains another tab and rejects writes queued before retirement acquired its lock', async () => {
  vi.resetModules();
  const tabA = await import('./cart-session-write-fence');
  vi.resetModules();
  const tabB = await import('./cart-session-write-fence');
  let finish!: (value: string) => void;
  const oldRequest = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  const pending = tabA.runBoundedCartSessionWrite(
    'shop',
    'blocked',
    oldRequest
  );
  await tick();
  expect(oldRequest).toHaveBeenCalledOnce();
  const retirement = tabB.beginCartSessionRetirement('shop');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  await tick();
  expect(drained).not.toHaveBeenCalled();
  const queuedRequest = vi.fn().mockResolvedValue('unsafe');
  const queued = tabA.runBoundedCartSessionWrite(
    'shop',
    'blocked',
    queuedRequest
  );
  finish('finished');
  await pending;
  await retirement.drained;
  expect(drained).toHaveBeenCalledOnce();
  retirement.release();
  await expect(queued).resolves.toBe('blocked');
  expect(queuedRequest).not.toHaveBeenCalled();
});
it('fails closed when a secure browser cannot coordinate other tabs', async () => {
  Reflect.deleteProperty(navigator, 'locks');
  const { withCartCookieWrite, beginCartCookieRetirement } = await import(
    './cart-cross-tab-lock'
  );
  const operation = vi.fn().mockResolvedValue('unsafe');
  expect(() =>
    withCartCookieWrite('blocked', new AbortController().signal, operation)
  ).toThrow('coordination');
  const retirement = beginCartCookieRetirement(100);
  await expect(retirement.drained).rejects.toThrow('coordination');
  expect(operation).not.toHaveBeenCalled();
});
it('bounds lock acquisition when another tab keeps the retirement lock', async () => {
  const { beginCartCookieRetirement } = await import('./cart-cross-tab-lock');
  const first = beginCartCookieRetirement(1000);
  await first.drained;
  const second = beginCartCookieRetirement(10);
  await expect(second.drained).rejects.toThrow('aborted');
  second.release();
  first.release();
});

it('revokes the cookie installed by an already-running request in another tab', async () => {
  vi.resetModules();
  const tabA = await import('./cart-session-write-fence');
  let finish!: () => void;
  let cookie = 'old';
  const write = tabA.runBoundedCartSessionWrite(
    'shop',
    'blocked',
    () =>
      new Promise<string>((resolve) => {
        finish = () => {
          cookie = 'late response';
          resolve('done');
        };
      })
  );
  await tick();
  vi.resetModules();
  const tabB = await import('./shared-cart-session-revoke-client');
  const { fetchWithCsrf } = await import('@/lib/api-client');
  let observedCookie: string | null = null;
  vi.mocked(fetchWithCsrf).mockImplementation(() => {
    observedCookie = cookie;
    return Promise.resolve(Response.json({ revoked: true }));
  });
  tabB.markCartDeviceRevocationPending('shop');
  const revocation = tabB.revokeCartDeviceSession('shop');
  await tick();
  expect(fetchWithCsrf).not.toHaveBeenCalled();
  finish();
  await write;
  await expect(revocation).resolves.toEqual({ ok: true });
  expect(observedCookie).toBe('late response');
});

it('releases an active shared lock when an aborted transport does not settle', async () => {
  const { withCartCookieWrite, beginCartCookieRetirement } = await import(
    './cart-cross-tab-lock'
  );
  const controller = new AbortController();
  const write = withCartCookieWrite(
    'blocked',
    controller.signal,
    () => new Promise<string>(() => {})
  );
  await tick();
  controller.abort();
  await expect(write).resolves.toBe('blocked');
  const retirement = beginCartCookieRetirement(100);
  await retirement.drained;
  retirement.release();
});

it.each([
  'checkout',
  'handoff',
] as const)('includes the %s cookie response in another tab retirement drain', async (kind) => {
  vi.resetModules();
  const { fetchWithCsrf } = await import('@/lib/api-client');
  let finish!: (response: Response) => void;
  vi.mocked(fetchWithCsrf).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const request =
    kind === 'checkout'
      ? (
          await import('./shared-cart-checkout-client')
        ).prepareSharedCartCheckout(
          { cartId: 'cart', expectedVersion: 1, operationId: 'review' },
          'shop'
        )
      : (
          await import('@/components/storefront/cart/cart-handoff-redeem')
        ).postHandoffRedeem(
          {
            handoffId: 'handoff',
            merchantSlug: 'shop',
            bootstrapRequired: { current: false },
            setRedeeming: vi.fn(),
            setRedeemError: vi.fn(),
            setConflicts: vi.fn(),
            setResolutions: vi.fn(),
            setLoadError: vi.fn(),
            onAttemptConsumed: vi.fn(),
            onTerminalOutcome: vi.fn(),
            onMergeConflict: vi.fn(),
            refreshPreview: () => Promise.resolve(null),
          },
          { attemptId: 'retained-attempt' }
        );
  await tick();
  expect(fetchWithCsrf).toHaveBeenCalledOnce();
  vi.resetModules();
  const otherTab = await import('./cart-session-write-fence');
  const retirement = otherTab.beginCartSessionRetirement('shop');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  try {
    await tick();
    expect(drained).not.toHaveBeenCalled();
    finish(Response.json({ code: 'temporarily_unavailable' }, { status: 503 }));
    await request;
    await retirement.drained;
    expect(drained).toHaveBeenCalledOnce();
  } finally {
    finish(Response.json({}, { status: 503 }));
    retirement.release();
  }
});

it('observes another tab completing the same durable retirement instead of revoking a replacement cart again', async () => {
  vi.resetModules();
  const tabA = await import('./shared-cart-session-revoke-client');
  tabA.markCartDeviceRevocationPending('shop');
  expect(tabA.isCartDeviceRevocationPending('shop')).toBe(true);
  vi.resetModules();
  const tabB = await import('./shared-cart-session-revoke-client');
  const { fetchWithCsrf } = await import('@/lib/api-client');
  vi.mocked(fetchWithCsrf).mockResolvedValue(Response.json({ revoked: true }));
  await expect(tabB.revokeCartDeviceSession('shop')).resolves.toEqual({
    ok: true,
  });
  expect(tabA.isCartDeviceRevocationPending('shop')).toBe(false);
});

it('rejects a handoff queued before another tab retires authority', async () => {
  vi.resetModules();
  const writer = await import('./cart-session-write-fence');
  vi.resetModules();
  const retiring = await import('./cart-session-write-fence');
  vi.resetModules();
  const selecting = await import('./cart-session-write-fence');
  let finish!: (value: string) => void;
  const writing = writer.runBoundedCartSessionWrite(
    'shop',
    'blocked',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await tick();
  const retirement = retiring.beginCartSessionRetirement('shop');
  await tick();
  const operation = vi.fn().mockResolvedValue('unsafe');
  const selection = selecting.runCartSessionTransition(
    'shop',
    'blocked',
    operation
  );
  finish('done');
  await writing;
  await retirement.drained;
  retirement.release();
  await expect(selection).resolves.toBe('blocked');
  expect(operation).not.toHaveBeenCalled();
});
