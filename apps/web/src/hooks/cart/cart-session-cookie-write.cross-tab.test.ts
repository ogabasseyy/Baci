import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CookieLockHarness } from './cart-cross-tab-lock.test-support';

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
const originalSecure = Object.getOwnPropertyDescriptor(
  window,
  'isSecureContext'
);

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

it('drains a quantity response before a cross-tab cart selection', async () => {
  const writerTab = await import('./cart-session-cookie-write');
  let finishResponse!: () => void;
  const order: string[] = [];
  const quantityWrite = writerTab.runCartSessionCookieWrite(
    'shop',
    null,
    async () =>
      new Promise<void>((resolve) => {
        finishResponse = () => {
          order.push('quantity Set-Cookie response settled');
          resolve();
        };
      })
  );
  await tick();

  vi.resetModules();
  const selectingFence = await import('./cart-session-write-fence');
  const selectCart = vi.fn(async () => {
    order.push('account cart selection started');
    return 'selected';
  });
  const selection = selectingFence.runCartSessionTransition(
    'shop',
    'blocked',
    selectCart,
    { isSuccessful: () => true }
  );
  await tick();

  expect(selectCart).not.toHaveBeenCalled();
  finishResponse();
  await expect(quantityWrite).resolves.toBeUndefined();
  await expect(selection).resolves.toBe('selected');
  expect(order).toEqual([
    'quantity Set-Cookie response settled',
    'account cart selection started',
  ]);
});

it('fails closed when a secure browser cannot coordinate cookie writes', async () => {
  Reflect.deleteProperty(navigator, 'locks');
  vi.resetModules();
  const { runCartSessionCookieWrite } = await import(
    './cart-session-cookie-write'
  );
  const request = vi.fn(async () => undefined);

  for (const isSecureContext of [true, false]) {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: isSecureContext,
    });
    await expect(
      runCartSessionCookieWrite('shop', null, request)
    ).resolves.toBeNull();
  }
  expect(request).not.toHaveBeenCalled();
});
