import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { performOxygenPaymentRecovery } from './payment-recovery';

const workflow = '60000000-0000-4000-8000-000000000001';
const reference = '70000000-0000-4000-8000-000000000001';
const command = '80000000-0000-4000-8000-000000000001';
const state = {
  reference,
  paymentComplete: true,
  setupComplete: true,
  paymentUrl: null,
  setupUrl: null,
  checkedAt: '2026-10-24T17:00:00Z',
  lastOutcome: 'succeeded',
  pending: false,
};
it.each([
  ['check_status', 'error-response'],
  ['check_status', 'lost-response'],
  ['check_status', 'missing-ack'],
  ['resend_upfront', 'error-response'],
  ['resend_upfront', 'lost-response'],
  ['resend_upfront', 'missing-ack'],
  ['resend_repayment', 'error-response'],
  ['resend_repayment', 'lost-response'],
  ['resend_repayment', 'missing-ack'],
] as const)('does not replace a successful %s response on %s', async (action, failure) => {
  let stored = false;
  const user = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      error: null,
      data:
        args.p_operation === 'enqueue'
          ? { commandId: command, status: stored ? 'succeeded' : 'queued' }
          : state,
    })),
  };
  const finishes: unknown[] = [];
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      if (args.p_operation === 'claim')
        return {
          error: null,
          data: { reference, action, environment: 'staging' },
        };
      finishes.push(args.p_payload);
      if (failure === 'lost-response') {
        stored = true;
        throw new Error('response lost after commit');
      }
      if (failure === 'missing-ack') return { error: null, data: null };
      return { error: { code: 'connection_failure' }, data: null };
    }),
  };
  const call = vi.fn().mockResolvedValue(
    action === 'check_status'
      ? {
          split_payment: { completed: true },
          repayment_setup: { completed: true },
        }
      : { url: 'https://payment.hydrogenpay.com/test' }
  );
  const run = () =>
    performOxygenPaymentRecovery(
      user,
      async () => worker,
      () => ({ call, environment: 'staging' }),
      new Set(['payment.hydrogenpay.com']),
      {
        workflowId: workflow,
        reference,
        version: 3,
        idempotencyKey: command,
        action,
      },
      () => async () => undefined
    );
  await expect(run()).rejects.toThrow();
  expect(finishes).toEqual([
    {
      commandId: command,
      outcome: 'succeeded',
      result:
        action === 'check_status'
          ? { paymentComplete: true, setupComplete: true }
          : action === 'resend_upfront'
            ? { paymentUrl: 'https://payment.hydrogenpay.com/test' }
            : { setupUrl: 'https://payment.hydrogenpay.com/test' },
    },
  ]);
  if (failure === 'lost-response') {
    await expect(run()).resolves.toMatchObject({ lastOutcome: 'succeeded' });
    expect(call).toHaveBeenCalledTimes(1);
  }
});
