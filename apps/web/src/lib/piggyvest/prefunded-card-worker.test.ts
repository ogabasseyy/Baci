import { expect, it, vi } from 'vitest';
import { createPrefundedCardWorker } from './prefunded-card-worker';

vi.mock('server-only', () => ({}));
const identity = '10000000-0000-4000-8000-000000000001';
const claim = { operationId: identity, token: identity };
const configuration = {
  environment: 'staging',
  integrationId: identity,
  merchantId: identity,
  treasuryBindingId: identity,
  businessId: 'business',
  expectedSystemId: '123',
  batchSize: 1,
};

it('runs a claimed operation once and acknowledges only its lease', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ result: [claim] }] })
    .mockResolvedValueOnce({ rows: [{ result: true }] });
  const run = vi.fn().mockResolvedValue({ outcome: 'pending' });
  const tick = createPrefundedCardWorker({ configuration, execute, run });
  expect(await tick()).toEqual({
    claimed: 1,
    processed: 1,
    failed: 0,
    unacknowledged: 0,
  });
  expect(run).toHaveBeenCalledExactlyOnceWith(identity);
  expect(execute.mock.calls[0][1]).toEqual([
    identity,
    'business',
    '123',
    '1',
    identity,
    identity,
  ]);
  expect(execute.mock.calls[1][1]).toEqual([identity, identity, '123']);
});
it('releases failed work for verify-only recovery without exposing raw errors', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ result: [claim] }] })
    .mockRejectedValue(new Error('private'));
  const run = vi.fn().mockRejectedValue(new Error('private provider'));
  const tick = createPrefundedCardWorker({ configuration, execute, run });
  expect(await tick()).toEqual({
    claimed: 1,
    processed: 0,
    failed: 1,
    unacknowledged: 1,
  });
});
it('refuses duplicate claims before any runtime execution', async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ rows: [{ result: [claim, claim] }] });
  const run = vi.fn();
  const tick = createPrefundedCardWorker({
    configuration: { ...configuration, batchSize: 2 },
    execute,
    run,
  });
  await expect(tick()).rejects.toThrow('claims unavailable');
  expect(run).not.toHaveBeenCalled();
});
it('does not acquire work after cancellation', async () => {
  const execute = vi.fn();
  const run = vi.fn();
  const tick = createPrefundedCardWorker({ configuration, execute, run });
  expect((await tick(AbortSignal.abort())).claimed).toBe(0);
  expect(execute).not.toHaveBeenCalled();
});
