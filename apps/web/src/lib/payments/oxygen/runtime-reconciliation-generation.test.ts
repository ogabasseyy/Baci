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
  expect(rpc.mock.calls.some(([, args]) => args.p_operation === 'defer')).toBe(
    false
  );
});

it('leaves ambiguous callbacks untouched and proceeds to later work', async () => {
  const ids = [
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000003',
  ];
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    error: null,
    data:
      args.p_operation === 'pending'
        ? [
            {
              id: ids[0],
              retryKey: ids[1],
              kind: 'transaction',
              workflowIds: ids,
            },
            {
              id: ids[2],
              retryKey: ids[2],
              kind: 'transaction',
              workflowIds: [ids[2]],
            },
          ]
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
  expect(paymentCheck).toHaveBeenCalledTimes(1);
  expect(paymentCheck).toHaveBeenCalledWith(ids[2], ids[2], ids[2]);
  expect(rpc.mock.calls.some(([, args]) => args.p_operation === 'defer')).toBe(
    false
  );
  expect(rpc).toHaveBeenCalledWith('oxygen_callback', {
    p_operation: 'complete',
    p_partner: 'partner',
    p_payload: { id: ids[2], retryKey: ids[2] },
  });
});

it('does not consume retries for a callback repeatedly left behind by the read limit', async () => {
  const ids = [
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000003',
  ];
  let due = ids;
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    error: null,
    data:
      args.p_operation === 'pending'
        ? due.map((id) => ({
            id,
            retryKey: id,
            kind: 'transaction',
            workflowIds: [id],
          }))
        : { recorded: true },
  }));
  const paymentCheck = vi.fn().mockRejectedValue(new Error('not confirmed'));
  for (let i = 0; i < 6; i++) {
    await reconcileOxygenCallbacks(
      { rpc },
      { call: vi.fn() },
      'partner',
      new Set(),
      paymentCheck
    );
  }
  const deferred = rpc.mock.calls.filter(
    ([, args]) => args.p_operation === 'defer'
  );
  expect(deferred).toHaveLength(12);
  expect(
    deferred.every(
      ([, args]) => (args.p_payload as { id: string }).id !== ids[2]
    )
  ).toBe(true);
  expect(paymentCheck.mock.calls.every(([id]) => id !== ids[2])).toBe(true);
  due = [ids[2]];
  paymentCheck.mockResolvedValue(undefined);
  await reconcileOxygenCallbacks(
    { rpc },
    { call: vi.fn() },
    'partner',
    new Set(),
    paymentCheck
  );
  expect(paymentCheck).toHaveBeenLastCalledWith(ids[2], ids[2], ids[2]);
  expect(rpc).toHaveBeenCalledWith('oxygen_callback', {
    p_operation: 'complete',
    p_partner: 'partner',
    p_payload: { id: ids[2], retryKey: ids[2] },
  });
});
