import { expect, it, vi } from 'vitest';
import { runCartEventsOnce } from './process-cart-events';

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

it('continues publishing when retention fails and reports only a safe cleanup error', async () => {
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
  ).toBe(0);
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

it('retries failed cleanup next pass while keeping the publisher running', async () => {
  const { createCartRetentionScheduler } = await import(
    '@/lib/cart/retention-scheduler'
  );
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { message: 'private' } })
    .mockResolvedValue({ data: null, error: null });
  const cleanup = createCartRetentionScheduler({
    client: () => ({ rpc }),
    now: () => 1000,
  });
  const run = vi
    .fn()
    .mockResolvedValue({ ok: true, sent: 0, failed: 0, deadLettered: 0 });
  const logger = { info: vi.fn(), error: vi.fn() };
  const env = { COMMERCE_CART_EVENTS_ENABLED: 'true' };
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(0);
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(0);
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(2);
  expect(logger.error).toHaveBeenCalledWith(
    '[cart-events] retention unavailable'
  );
});
it('continues publishing after cleanup throws, but publisher failures still stop the worker', async () => {
  const cleanup = vi.fn().mockRejectedValue(new Error('private detail'));
  const run = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, sent: 0, failed: 0, deadLettered: 0 })
    .mockResolvedValueOnce({ ok: false });
  const logger = { info: vi.fn(), error: vi.fn() };
  const env = { COMMERCE_CART_EVENTS_ENABLED: 'true' };
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(0);
  expect(await runCartEventsOnce({ env, run, cleanup, logger })).toBe(1);
  expect(run).toHaveBeenCalledTimes(2);
  expect(logger.error).toHaveBeenCalledWith(
    '[cart-events] publisher unavailable'
  );
});
