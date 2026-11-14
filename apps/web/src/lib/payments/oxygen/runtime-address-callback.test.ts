import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { reconcileOxygenCallbacks } from './runtime-reconciliation';

it('retires a redelivered address hint for an activated workflow without rechecking or changing it', async () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const retryKey = '60000000-0000-4000-8000-000000000002';
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const operation = args.p_operation;
    let data: unknown = { recorded: true };
    if (operation === 'pending')
      data = [{ id, retryKey, kind: 'address', workflowIds: [id] }];
    if (operation === 'worker_status')
      data = {
        workflowId: id,
        stage: 'activated',
        version: 10,
        environment: 'staging',
        executionEnabled: true,
        state: { paymentComplete: true, setupComplete: true },
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      };
    return { data, error: null };
  });
  const call = vi.fn();
  await reconcileOxygenCallbacks({ rpc }, { call }, 'partner', new Set());
  expect(call).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalledWith(
    'oxygen_runtime',
    expect.objectContaining({ p_operation: 'reconcile' })
  );
  expect(rpc).toHaveBeenCalledWith('oxygen_callback', {
    p_operation: 'complete',
    p_partner: 'partner',
    p_payload: { id, retryKey },
  });
});

it.each([
  'DONE',
  'PROCESSING',
  'cached_processing',
] as const)('requires confirmed KYC before retiring an address callback (%s)', async (mode) => {
  const id = '60000000-0000-4000-8000-000000000001';
  const commandId = '60000000-0000-4000-8000-000000000002';
  const booking = '70000000-0000-4000-8000-000000000001';
  const kyc = {
    phone_status: 'DONE',
    bvn_status: 'DONE',
    nin_status: 'DONE',
    bank_status: 'DONE',
    selfie_status: 'DONE',
    address_status: 'PROCESSING',
  };
  const state = {
    applicationReference: id,
    bookingReference: booking,
    validated: true,
    eligible: true,
    kyc,
  };
  const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => {
    const op = args.p_operation;
    let data: unknown = { recorded: true };
    if (op === 'pending')
      data = [{ id, retryKey: commandId, kind: 'address', workflowIds: [id] }];
    if (op === 'worker_status')
      data = {
        workflowId: id,
        stage: 'booked',
        version: 4,
        environment: 'staging',
        executionEnabled: true,
        state,
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      };
    if (op === 'reconcile')
      data = {
        commandId,
        status: mode === 'cached_processing' ? 'succeeded' : 'queued',
      };
    if (op === 'claim')
      data = {
        context: {
          workflowId: id,
          orderId: id,
          stage: 'booked',
          version: 4,
          environment: 'staging',
          partnerReference: 'partner',
          merchantReference: null,
          productAmount: 400000,
          orderPhone: '08012345678',
          productName: 'Fixture',
          address: 'Test Street',
          state,
        },
      };
    return { data, error: null };
  });
  const call = vi.fn().mockResolvedValue({
    ...kyc,
    address_status: mode === 'DONE' ? 'DONE' : 'PROCESSING',
  });
  await reconcileOxygenCallbacks({ rpc }, { call }, 'partner', new Set());
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_callback',
    expect.objectContaining({
      p_operation: mode === 'DONE' ? 'complete' : 'defer',
    })
  );
  if (mode === 'cached_processing') expect(call).not.toHaveBeenCalled();
  else {
    expect(call).toHaveBeenCalledExactlyOnceWith('kyc', {
      loan_request_reference: id,
      partner_reference: 'partner',
    });
    expect(rpc).toHaveBeenCalledWith(
      'oxygen_runtime',
      expect.objectContaining({
        p_operation: 'finish',
        p_payload: expect.objectContaining({
          stage: mode === 'DONE' ? 'approval_required' : 'booked',
        }),
      })
    );
  }
});
