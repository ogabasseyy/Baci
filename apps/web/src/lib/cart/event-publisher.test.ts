import { expect, it, vi } from 'vitest';
import { publishCartEvents } from './event-publisher';

it('invokes one bounded transactional publish and reports only numeric metrics', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { sent: 2, failed: 1, deadLettered: 0, secret: 'must-not-escape' },
    error: null,
  });
  expect(await publishCartEvents({ rpc }, 'worker-1')).toEqual({
    ok: true,
    sent: 2,
    failed: 1,
    deadLettered: 0,
  });
  expect(rpc).toHaveBeenCalledWith('commerce_cart_publish_events', {
    p_limit: 50,
    p_worker_id: 'worker-1',
  });
});
it('masks provider errors and never acknowledges a malformed batch', async () => {
  for (const result of [
    { data: null, error: { message: 'private-db-error' } },
    { data: { sent: Number.POSITIVE_INFINITY }, error: null },
  ]) {
    expect(
      await publishCartEvents(
        { rpc: vi.fn().mockResolvedValue(result) },
        'worker-1'
      )
    ).toEqual({ ok: false });
  }
});
it('rejects unbounded batches before accessing the database', async () => {
  const rpc = vi.fn();
  expect(await publishCartEvents({ rpc }, 'worker-1', 51)).toEqual({
    ok: false,
  });
  expect(rpc).not.toHaveBeenCalled();
});
