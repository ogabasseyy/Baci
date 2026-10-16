import { expect, it, vi } from 'vitest';
import { createCartRetentionScheduler } from './retention-scheduler';

it('calls the bounded cleanup RPC immediately, then only after five minutes', async () => {
  let now = 1000;
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const client = vi.fn(() => ({ rpc }));
  const cleanup = createCartRetentionScheduler({ client, now: () => now });
  expect(await cleanup()).toBe(true);
  expect(rpc).toHaveBeenCalledWith('cleanup_commerce_carts');
  now += 1000;
  expect(await cleanup()).toBe(true);
  expect(client).toHaveBeenCalledTimes(1);
  now += 299000;
  expect(await cleanup()).toBe(true);
  expect(client).toHaveBeenCalledTimes(2);
});

it('does not advance the schedule after an RPC error or thrown failure', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: null, error: { message: 'private detail' } })
    .mockRejectedValueOnce(new Error('private detail'))
    .mockResolvedValue({ data: null, error: null });
  const client = vi.fn(() => ({ rpc }));
  let now = 1000;
  const cleanup = createCartRetentionScheduler({ client, now: () => now });
  expect(await cleanup()).toBe(false);
  now += 30_000;
  expect(await cleanup()).toBe(false);
  now += 60_000;
  expect(await cleanup()).toBe(true);
  expect(await cleanup()).toBe(true);
  expect(client).toHaveBeenCalledTimes(3);
});

it('backs off after failures instead of retrying on every pass', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: { message: 'private detail' } });
  const client = vi.fn(() => ({ rpc }));
  let now = 0;
  const cleanup = createCartRetentionScheduler({ client, now: () => now });
  expect(await cleanup()).toBe(false);
  // Deferred passes neither call the RPC nor report failure again.
  now += 1000;
  expect(await cleanup()).toBe(true);
  expect(client).toHaveBeenCalledTimes(1);
  // The first retry lands after the 30-second base delay and doubles.
  now += 29_000;
  expect(await cleanup()).toBe(false);
  expect(client).toHaveBeenCalledTimes(2);
  now += 59_000;
  expect(await cleanup()).toBe(true);
  expect(client).toHaveBeenCalledTimes(2);
  now += 1000;
  expect(await cleanup()).toBe(false);
  expect(client).toHaveBeenCalledTimes(3);
});
