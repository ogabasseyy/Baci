import { expect, it, vi } from 'vitest';
import { CART_REQUEST_TIMEOUT_MS } from './cart-request-deadline';
import {
  beginCartSessionRetirement,
  runCartSessionCookieWrite,
  runCartSessionTransition,
  runCartSessionWrite,
} from './cart-session-write-fence';

it('drains existing writes and blocks replacement authority until retirement finishes', async () => {
  let finish!: () => void;
  const pending = runCartSessionWrite(
    'shop',
    false,
    () =>
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      })
  );
  await Promise.resolve();
  const retirement = beginCartSessionRetirement('shop');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  const replacement = vi.fn().mockResolvedValue(true);
  await expect(runCartSessionWrite('shop', false, replacement)).resolves.toBe(
    false
  );
  expect(replacement).not.toHaveBeenCalled();
  expect(drained).not.toHaveBeenCalled();
  finish();
  await pending;
  await retirement.drained;
  retirement.release();
  await expect(runCartSessionWrite('shop', false, replacement)).resolves.toBe(
    true
  );
});
it('includes host-resolved writes while keeping named merchants isolated', async () => {
  const retirement = beginCartSessionRetirement('shop');
  await expect(
    runCartSessionWrite(undefined, false, async () => true)
  ).resolves.toBe(false);
  await expect(
    runCartSessionWrite('other', false, async () => true)
  ).resolves.toBe(true);
  retirement.release();
});
it('holds the retirement fence until aborted transition work actually settles', async () => {
  const { isCartSessionRetiring, runCartSessionTransition } = await import(
    './cart-session-write-fence'
  );
  const controller = new AbortController();
  let finish!: (value: string) => void;
  const operation = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  const pending = runCartSessionTransition('shop-fence', 'blocked', operation, {
    isSuccessful: () => true,
    signal: controller.signal,
  });
  // Let the transition acquire its retirement and start the operation.
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(operation).toHaveBeenCalledOnce();
  controller.abort();
  await expect(pending).resolves.toBe('blocked');
  // The caller-visible result settled, but the fence must remain held
  // while the signal-ignoring operation is still running.
  expect(isCartSessionRetiring('shop-fence')).toBe(true);
  // A new retirement must not drain until the work settles either.
  const { beginCartSessionRetirement } = await import(
    './cart-session-write-fence'
  );
  const retirement = beginCartSessionRetirement('shop-fence');
  const drained = vi.fn();
  void retirement.drained.then(drained);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(drained).not.toHaveBeenCalled();
  finish('done');
  await retirement.drained;
  retirement.release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(isCartSessionRetiring('shop-fence')).toBe(false);
});

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
