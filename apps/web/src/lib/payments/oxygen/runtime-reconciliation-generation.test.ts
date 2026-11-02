import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { reconcileOxygenCallbacks } from './runtime-reconciliation';

it('rejects a callback job without a retry generation before provider work', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const rpc = vi.fn().mockResolvedValue({
    data: [{ id, kind: 'address', workflowIds: [id] }],
    error: null,
  });
  const call = vi.fn();
  await expect(
    reconcileOxygenCallbacks({ rpc }, { call }, 'partner', new Set())
  ).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(call).not.toHaveBeenCalled();
});

it('uses at most two reads and completes those jobs before leaving later work', async () => {
  const ids = [
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000003',
  ];
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    error: null,
    data:
      args.p_operation === 'pending'
        ? ids.map((id) => ({
            id,
            retryKey: id,
            kind: 'transaction',
            workflowIds: [id],
          }))
        : { recorded: true },
  }));
  const paymentCheck = vi.fn().mockResolvedValue(undefined);
  await reconcileOxygenCallbacks(
    { rpc },
    { call: vi.fn() },
    'partner',
    new Set(),
    paymentCheck
  );
  expect(paymentCheck).toHaveBeenCalledTimes(2);
  expect(paymentCheck.mock.calls.map(([id]) => id)).toEqual(ids.slice(0, 2));
  expect(
    rpc.mock.calls.filter(([, args]) => args.p_operation === 'complete')
  ).toHaveLength(2);
});
