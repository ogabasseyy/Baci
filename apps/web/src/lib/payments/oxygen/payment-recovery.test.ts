import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { performOxygenPaymentRecovery } from './payment-recovery';

const observerFactory = () => async () => undefined;
const workflow = '60000000-0000-4000-8000-000000000001';
const reference = '70000000-0000-4000-8000-000000000001';
const command = '80000000-0000-4000-8000-000000000001';
const state = {
  reference,
  paymentComplete: false,
  setupComplete: true,
  paymentUrl: null,
  setupUrl: null,
  checkedAt: '2026-10-24T17:00:00Z',
  lastOutcome: 'succeeded',
  pending: false,
};
const input = {
  workflowId: workflow,
  reference,
  version: 3,
  idempotencyKey: command,
  action: 'resend_upfront' as const,
};
function fixture() {
  const user = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data:
        args.p_operation === 'enqueue'
          ? { commandId: command, status: 'queued' }
          : state,
      error: null,
    })),
  };
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data:
        args.p_operation === 'claim'
          ? { reference, action: 'resend_upfront' }
          : { recorded: true },
      error: null,
    })),
  };
  const provider = {
    call: vi.fn().mockResolvedValue({
      message: 'Repayment setup initialized successfully',
      url: 'https://payment.hydrogenpay.com/?transactionId=synthetic',
    }),
  };
  return { user, worker, provider };
}
it('uses the exact claimed reference and persists an authenticated provider link without altering approval', async () => {
  const { user, worker, provider } = fixture();
  await performOxygenPaymentRecovery(
    user,
    async () => worker,
    () => provider,
    new Set(['payment.hydrogenpay.com']),
    input,
    observerFactory
  );
  expect(provider.call).toHaveBeenCalledExactlyOnceWith('upfront_link', {
    loan_reference: reference,
  });
  expect(worker.rpc).toHaveBeenCalledWith(
    'oxygen_payment_recovery',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({
        commandId: command,
        outcome: 'succeeded',
        result: {
          paymentUrl:
            'https://payment.hydrogenpay.com/?transactionId=synthetic',
        },
      }),
    })
  );
});
it('does not contact Oxygen for an already succeeded idempotency key', async () => {
  const { user, worker, provider } = fixture();
  user.rpc.mockResolvedValueOnce({
    data: { commandId: command, status: 'succeeded' },
    error: null,
  } as never);
  await performOxygenPaymentRecovery(
    user,
    async () => worker,
    () => provider,
    new Set(),
    input,
    observerFactory
  );
  expect(provider.call).not.toHaveBeenCalled();
  expect(worker.rpc).not.toHaveBeenCalled();
});
it('rejects a changed reference before any provider call', async () => {
  const { user, worker, provider } = fixture();
  worker.rpc.mockResolvedValueOnce({
    data: { reference: workflow, action: 'resend_upfront' },
    error: null,
  } as never);
  await expect(
    performOxygenPaymentRecovery(
      user,
      async () => worker,
      () => provider,
      new Set(),
      input,
      observerFactory
    )
  ).rejects.toThrow();
  expect(provider.call).not.toHaveBeenCalled();
});
it('keeps an untrusted returned link out of customer state and does not replay', async () => {
  const { user, worker, provider } = fixture();
  provider.call.mockResolvedValue({
    url: 'https://payment.hydrogenpay.com.evil.test/?secret=private',
  });
  await expect(
    performOxygenPaymentRecovery(
      user,
      async () => worker,
      () => provider,
      new Set(['payment.hydrogenpay.com']),
      input,
      observerFactory
    )
  ).rejects.toThrow();
  expect(provider.call).toHaveBeenCalledTimes(1);
  expect(worker.rpc).toHaveBeenCalledWith(
    'oxygen_payment_recovery',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({ outcome: 'indeterminate' }),
    })
  );
  expect(JSON.stringify(worker.rpc.mock.calls)).not.toContain('secret=private');
});
it('does not interpret status completion as approved terms', async () => {
  const { user, worker, provider } = fixture();
  worker.rpc.mockResolvedValueOnce({
    data: { reference, action: 'check_status' },
    error: null,
  } as never);
  provider.call.mockResolvedValue({
    split_payment: { completed: false },
    repayment_setup: { completed: true },
  });
  await performOxygenPaymentRecovery(
    user,
    async () => worker,
    () => provider,
    new Set(),
    { ...input, action: 'check_status' },
    observerFactory
  );
  expect(provider.call).toHaveBeenCalledExactlyOnceWith('payment', {
    loan_reference: reference,
  });
  expect(worker.rpc).toHaveBeenCalledWith(
    'oxygen_payment_recovery',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({
        result: { paymentComplete: false, setupComplete: true },
      }),
    })
  );
  expect(JSON.stringify(worker.rpc.mock.calls)).not.toContain('APPROVED');
});
it('records a lost resend as indeterminate and never automatically retries', async () => {
  const { user, worker, provider } = fixture();
  const { OxygenProviderFailure } = await import('./provider');
  provider.call.mockRejectedValue(new OxygenProviderFailure('indeterminate'));
  await expect(
    performOxygenPaymentRecovery(
      user,
      async () => worker,
      () => provider,
      new Set(),
      input,
      observerFactory
    )
  ).rejects.toThrow();
  expect(provider.call).toHaveBeenCalledTimes(1);
  expect(worker.rpc).toHaveBeenCalledWith(
    'oxygen_payment_recovery',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({ outcome: 'indeterminate' }),
    })
  );
});
it('preserves captured evidence before a malformed successful reply fails validation', async () => {
  const { user, worker, provider } = fixture();
  const observe = vi.fn().mockResolvedValue(undefined);
  provider.call.mockImplementation(async () => {
    await observe();
    return { message: 'initialized' };
  });
  await expect(
    performOxygenPaymentRecovery(
      user,
      async () => worker,
      () => provider,
      new Set(),
      input,
      () => observe
    )
  ).rejects.toThrow();
  expect(observe).toHaveBeenCalledTimes(1);
  expect(provider.call).toHaveBeenCalledTimes(1);
});
it('abandons only a queued recovery intent when worker sign-in fails before any provider request', async () => {
  const { user, provider } = fixture();
  await expect(
    performOxygenPaymentRecovery(
      user,
      async () => {
        throw new Error('Worker sign-in unavailable');
      },
      () => provider,
      new Set(),
      input,
      observerFactory
    )
  ).rejects.toThrow();
  expect(provider.call).not.toHaveBeenCalled();
  expect(user.rpc).toHaveBeenCalledWith(
    'oxygen_payment_recovery',
    expect.objectContaining({
      p_operation: 'abandon',
      p_payload: { commandId: command },
    })
  );
});
it('uses repayment-link recovery separately from upfront recovery', async () => {
  const { user, worker, provider } = fixture();
  worker.rpc.mockResolvedValueOnce({
    data: { reference, action: 'resend_repayment' },
    error: null,
  } as never);
  await performOxygenPaymentRecovery(
    user,
    async () => worker,
    () => provider,
    new Set(['payment.hydrogenpay.com']),
    { ...input, action: 'resend_repayment' },
    observerFactory
  );
  expect(provider.call).toHaveBeenCalledExactlyOnceWith('repayment_link', {
    loan_reference: reference,
  });
  expect(worker.rpc).toHaveBeenCalledWith(
    'oxygen_payment_recovery',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({
        result: {
          setupUrl: 'https://payment.hydrogenpay.com/?transactionId=synthetic',
        },
      }),
    })
  );
});
