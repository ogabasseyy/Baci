import { expect, it, vi } from 'vitest';
import {
  cartEventsRetryDelayMs,
  createAbortableSleep,
  runCartEventsOnce,
} from './process-cart-events';

it('wakes a backoff sleep immediately when stopped', async () => {
  vi.useFakeTimers();
  try {
    const backoff = createAbortableSleep();
    let resolved = false;
    const sleeping = backoff.sleep(60_000).then(() => {
      resolved = true;
    });
    backoff.wake();
    await sleeping;
    expect(resolved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('lets a backoff sleep elapse normally without a wake', async () => {
  vi.useFakeTimers();
  try {
    const backoff = createAbortableSleep();
    let resolved = false;
    const sleeping = backoff.sleep(5_000).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await sleeping;
    expect(resolved).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it('backs off exponentially after failed passes, capped at one minute', () => {
  expect(cartEventsRetryDelayMs(0)).toBe(1_000);
  expect(cartEventsRetryDelayMs(1)).toBe(1_000);
  expect(cartEventsRetryDelayMs(2)).toBe(2_000);
  expect(cartEventsRetryDelayMs(3)).toBe(4_000);
  expect(cartEventsRetryDelayMs(6)).toBe(32_000);
  expect(cartEventsRetryDelayMs(7)).toBe(60_000);
  expect(cartEventsRetryDelayMs(30)).toBe(60_000);
});

it('is disabled without explicit worker activation and never loads a credential', async () => {
  const run = vi.fn();
  const cleanup = vi.fn();
  expect(await runCartEventsOnce({ env: {}, run, cleanup })).toBe(0);
  expect(run).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
});
it('reports only bounded publisher metrics and fails safely on outages', async () => {
  const info = vi.fn();
  const error = vi.fn();
  expect(
    await runCartEventsOnce({
      env: { COMMERCE_CART_EVENTS_ENABLED: 'true' },
      cleanup: async () => true,
      run: async () => ({ ok: true, sent: 1, failed: 0, deadLettered: 0 }),
      logger: { info, error },
    })
  ).toBe(0);
  expect(info).toHaveBeenCalledWith('[cart-events] batch', {
    sent: 1,
    failed: 0,
    deadLettered: 0,
  });
  expect(
    await runCartEventsOnce({
      env: { COMMERCE_CART_EVENTS_ENABLED: 'true' },
      cleanup: async () => true,
      run: async () => {
        throw new Error('private credential detail');
      },
      logger: { info, error },
    })
  ).toBe(1);
  expect(error).toHaveBeenCalledWith('[cart-events] publisher unavailable');
});

it('continues publishing when retention fails but reports the pass as degraded', async () => {
  const cleanup = vi.fn().mockResolvedValue(false);
  const logger = { info: vi.fn(), error: vi.fn() };
  const run = vi
    .fn()
    .mockResolvedValue({ ok: true, sent: 0, failed: 0, deadLettered: 0 });
  expect(
    await runCartEventsOnce({
      env: { COMMERCE_CART_EVENTS_ENABLED: 'true' },
      run,
      cleanup,
      logger,
    })
  ).toBe(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith(
    '[cart-events] retention unavailable'
  );
});
it('uses one retained cleanup schedule across loop passes without touching credentials while disabled', async () => {
  const { createCartRetentionScheduler } = await import(
    '@/lib/cart/retention-scheduler'
  );
  let now = 0;
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const client = vi.fn(() => ({ rpc }));
  const cleanup = createCartRetentionScheduler({ client, now: () => now });
  const run = vi
    .fn()
    .mockResolvedValue({ ok: true, sent: 0, failed: 0, deadLettered: 0 });
  expect(await runCartEventsOnce({ env: {}, run, cleanup })).toBe(0);
  expect(client).not.toHaveBeenCalled();
  const env = { COMMERCE_CART_EVENTS_ENABLED: 'true' };
  expect(await runCartEventsOnce({ env, run, cleanup })).toBe(0);
  now += 1000;
  expect(await runCartEventsOnce({ env, run, cleanup })).toBe(0);
  expect(client).toHaveBeenCalledTimes(1);
  now += 299000;
  expect(await runCartEventsOnce({ env, run, cleanup })).toBe(0);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(3);
});

it('retries failed cleanup after its backoff while keeping the publisher running', async () => {
  const { createCartRetentionScheduler } = await import(
    '@/lib/cart/retention-scheduler'
  );
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { message: 'private' } })
    .mockResolvedValue({ data: null, error: null });
  let now = 1000;
  const cleanup = createCartRetentionScheduler({
    client: () => ({ rpc }),
    now: () => now,
  });
  const run = vi
    .fn()
    .mockResolvedValue({ ok: true, sent: 0, failed: 0, deadLettered: 0 });
  const logger = { info: vi.fn(), error: vi.fn() };
  const env = { COMMERCE_CART_EVENTS_ENABLED: 'true' };
  // The failed cleanup attempt degrades the pass even though the
  // publisher succeeded.
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(1);
  // The next pass is inside the failure backoff: no retry, no log spam,
  // but the publisher still runs and the deferred pass is not degraded.
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(0);
  expect(rpc).toHaveBeenCalledTimes(1);
  now += 30_000;
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(0);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(3);
  expect(logger.error).toHaveBeenCalledWith(
    '[cart-events] retention unavailable'
  );
});
it('reports degraded after cleanup throws, and publisher failures still stop the worker', async () => {
  const cleanup = vi.fn().mockRejectedValue(new Error('private detail'));
  const run = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, sent: 0, failed: 0, deadLettered: 0 })
    .mockResolvedValueOnce({ ok: false });
  const logger = { info: vi.fn(), error: vi.fn() };
  const env = { COMMERCE_CART_EVENTS_ENABLED: 'true' };
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(1);
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(1);
  expect(run).toHaveBeenCalledTimes(2);
  expect(logger.error).toHaveBeenCalledWith(
    '[cart-events] publisher unavailable'
  );
});
