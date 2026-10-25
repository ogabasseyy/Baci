import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  acceptOxygenCallback,
  reconcileOxygenCallbacks,
} from './runtime-reconciliation';

it('acknowledges only durable storage and never treats settlement as received funds', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { result: 'accepted' }, error: null });
  await expect(
    acceptOxygenCallback({ rpc }, 'partner', {
      kind: 'address',
      phoneNumber: '2348012345678',
      action: 'reconcile_kyc',
    })
  ).resolves.toBe('accepted');
  rpc.mockResolvedValue({ data: null, error: { code: 'storage_failure' } });
  await expect(
    acceptOxygenCallback({ rpc }, 'partner', {
      kind: 'address',
      phoneNumber: '2348012345678',
      action: 'reconcile_kyc',
    })
  ).rejects.toThrow();
});
it('does not query or mutate the provider for unmatched callbacks', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [
      {
        id: '60000000-0000-4000-8000-000000000001',
        kind: 'transaction',
        workflowIds: [],
      },
    ],
    error: null,
  });
  const call = vi.fn();
  await reconcileOxygenCallbacks({ rpc }, { call }, 'partner', new Set());
  expect(call).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledTimes(1);
});

it.each([
  'success',
  'blocked',
  'timeout',
])('reconciles provider completion and preserves blocked callbacks (%s)', async (mode) => {
  const workflowId = '60000000-0000-4000-8000-000000000001';
  const commandId = '60000000-0000-4000-8000-000000000002';
  const loan = '70000000-0000-4000-8000-000000000001';
  const state = {
    applicationReference: workflowId,
    bookingReference: loan,
    booking: {
      loan_reference: loan,
      product_amount: 400000,
      loan_amount: 260000,
      equity_percentage: 35,
      equity_amount: 140000,
      loan_tenure: 3,
      status: 'APPROVED',
    },
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'oxygen_callback')
      return {
        data:
          args.p_operation === 'pending'
            ? [
                {
                  id: commandId,
                  kind: 'transaction',
                  workflowIds: [workflowId],
                  retryKey: loan,
                },
              ]
            : { recorded: true },
        error: null,
      };
    if (args.p_operation === 'worker_status')
      return {
        data: {
          workflowId,
          stage:
            mode === 'blocked' ? 'reconciliation_required' : 'payment_required',
          version: 4,
          environment: 'staging',
          executionEnabled: true,
          state,
          approvalOtpReady: false,
          activationEnabled: false,
          settlementEnabled: false,
        },
        error: null,
      };
    if (args.p_operation === 'reconcile')
      return { data: { commandId, status: 'queued' }, error: null };
    if (args.p_operation === 'claim')
      return {
        data: {
          context: {
            workflowId,
            orderId: workflowId,
            stage: 'payment_required',
            version: 4,
            environment: 'staging',
            partnerReference: 'partner',
            merchantReference: null,
            productAmount: 400000,
            orderPhone: '08012345678',
            productName: 'Order',
            address: 'Street',
            state,
          },
        },
        error: null,
      };
    return { data: { recorded: true }, error: null };
  });
  const call = vi.fn().mockResolvedValue({
    split_payment: { completed: false },
    repayment_setup: { completed: true },
  });
  if (mode === 'timeout') call.mockRejectedValue(new Error('timeout'));
  await reconcileOxygenCallbacks({ rpc }, { call }, 'partner', new Set());
  if (mode === 'timeout') {
    expect(rpc).toHaveBeenCalledWith(
      'oxygen_finish_failure',
      expect.objectContaining({
        p_outcome: 'failed',
        p_stage: 'payment_required',
        p_diagnostic: expect.objectContaining({
          operation: 'payment',
          kind: 'validation',
        }),
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'oxygen_callback',
      expect.objectContaining({ p_operation: 'defer' })
    );
    return;
  }
  if (mode === 'blocked') {
    expect(call).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'oxygen_callback',
      expect.objectContaining({ p_operation: 'defer' })
    );
    return;
  }
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_runtime',
    expect.objectContaining({
      p_operation: 'reconcile',
      p_payload: expect.objectContaining({ idempotencyKey: loan }),
    })
  );
  expect(call).toHaveBeenCalledExactlyOnceWith('payment', {
    loan_reference: loan,
  });
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_runtime',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({
        outcome: 'succeeded',
        stage: 'payment_required',
        state: expect.objectContaining({
          paymentComplete: false,
          setupComplete: true,
        }),
      }),
    })
  );
});

it.each([
  'success',
  'timeout',
])('routes a payment callback through independent recovery (%s)', async (mode) => {
  const id = '60000000-0000-4000-8000-000000000001';
  const retry = '60000000-0000-4000-8000-000000000002';
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
    error: null,
    data:
      args.p_operation === 'pending'
        ? [{ id, kind: 'transaction', retryKey: retry, workflowIds: [id] }]
        : { recorded: true },
  }));
  const call = vi.fn();
  const paymentCheck = vi.fn().mockResolvedValue(undefined);
  if (mode === 'timeout') paymentCheck.mockRejectedValue(new Error('timeout'));
  await reconcileOxygenCallbacks(
    { rpc },
    { call },
    'partner',
    new Set(),
    paymentCheck
  );
  expect(paymentCheck).toHaveBeenCalledExactlyOnceWith(id, id, retry);
  expect(call).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_callback',
    expect.objectContaining({
      p_operation: mode === 'success' ? 'complete' : 'defer',
    })
  );
});
