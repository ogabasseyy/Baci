import { expect, it, vi } from 'vitest';
import { CART_REQUEST_TIMEOUT_MS } from './cart-request-deadline';
import { runCartSessionCookieWrite } from './cart-session-cookie-write';
import { runCartSessionTransition } from './cart-session-write-fence';

it('holds the cookie fence after request timeout until the response settles', async () => {
  vi.useFakeTimers();
  try {
    let finishRequest!: (value: string) => void;
    let requestSignal!: AbortSignal;
    const request = runCartSessionCookieWrite('shop-cookie', null, (signal) => {
      requestSignal = signal;
      return new Promise<string>((resolve) => {
        finishRequest = resolve;
      });
    });
    await Promise.resolve();

    const transitionOperation = vi.fn(async () => 'selected');
    const transition = runCartSessionTransition(
      'shop-cookie',
      'blocked',
      transitionOperation,
      { isSuccessful: () => true }
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(CART_REQUEST_TIMEOUT_MS);

    expect(requestSignal.aborted).toBe(true);
    expect(transitionOperation).not.toHaveBeenCalled();

    finishRequest('response settled');
    await expect(request).resolves.toBe('response settled');
    await expect(transition).resolves.toBe('selected');
    expect(transitionOperation).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

it('releases the cookie fence when a cookie-setting request rejects', async () => {
  await expect(
    runCartSessionCookieWrite('shop-rejected', null, async () => {
      throw new Error('synthetic network failure');
    })
  ).rejects.toThrow('synthetic network failure');

  const transitionOperation = vi.fn(async () => 'selected');
  await expect(
    runCartSessionTransition('shop-rejected', 'blocked', transitionOperation, {
      isSuccessful: () => true,
    })
  ).resolves.toBe('selected');
  expect(transitionOperation).toHaveBeenCalledOnce();
});

it('aborts a cookie-setting fetch on pagehide without dropping the fence early', async () => {
  let finishRequest!: () => void;
  let requestSignal!: AbortSignal;
  const request = runCartSessionCookieWrite('shop-pagehide', null, (signal) => {
    requestSignal = signal;
    return new Promise<void>((resolve) => {
      finishRequest = resolve;
    });
  });
  await Promise.resolve();

  const transitionOperation = vi.fn(async () => 'selected');
  const transition = runCartSessionTransition(
    'shop-pagehide',
    'blocked',
    transitionOperation,
    { isSuccessful: () => true }
  );
  await Promise.resolve();
  window.dispatchEvent(new Event('pagehide'));

  expect(requestSignal.aborted).toBe(true);
  expect(transitionOperation).not.toHaveBeenCalled();
  finishRequest();
  await expect(request).resolves.toBeUndefined();
  await expect(transition).resolves.toBe('selected');
});
