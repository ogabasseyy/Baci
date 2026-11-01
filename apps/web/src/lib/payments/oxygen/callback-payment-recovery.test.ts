import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { reconcileOxygenCallbackPayment } from './callback-payment-recovery';

const workflow = '60000000-0000-4000-8000-000000000001';
const command = '60000000-0000-4000-8000-000000000002';
const reference = '70000000-0000-4000-8000-000000000001';
it.each([
  'confirmed',
  'incomplete',
  'timeout',
  'malformed',
  'duplicate',
  'duplicate_confirmed',
  'busy',
])('records callback status independently without approval or link mutations (%s)', async (mode) => {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    error: null,
    data:
      name === 'oxygen_callback_payment'
        ? {
            commandId: command,
            reference,
            environment: 'staging',
            result: mode.startsWith('duplicate')
              ? {
                  paymentComplete: mode === 'duplicate_confirmed',
                  setupComplete: true,
                }
              : null,
            status: mode.startsWith('duplicate')
              ? 'succeeded'
              : mode === 'busy'
                ? 'executing'
                : 'queued',
          }
        : args.p_operation === 'claim'
          ? { reference, action: 'check_status', environment: 'staging' }
          : { recorded: true },
  }));
  const call = vi.fn().mockResolvedValue(
    mode === 'malformed'
      ? {}
      : {
          split_payment: { completed: mode === 'confirmed' },
          repayment_setup: { completed: true },
        }
  );
  if (mode === 'timeout') call.mockRejectedValue(new Error('timeout'));
  const run = reconcileOxygenCallbackPayment(
    { rpc },
    () => ({ call }),
    workflow,
    command,
    reference
  );
  if (['timeout', 'malformed', 'busy'].includes(mode))
    await expect(run).rejects.toThrow();
  else
    await expect(run).resolves.toBe(
      mode === 'confirmed' || mode === 'duplicate_confirmed'
    );
  if (mode.startsWith('duplicate') || mode === 'busy')
    expect(call).not.toHaveBeenCalled();
  else {
    expect(call).toHaveBeenCalledExactlyOnceWith('payment', {
      loan_reference: reference,
    });
    expect(rpc).toHaveBeenCalledWith(
      'oxygen_payment_recovery',
      expect.objectContaining({
        p_operation: 'finish',
        p_payload: expect.objectContaining({
          outcome: ['timeout', 'malformed'].includes(mode)
            ? 'failed'
            : 'succeeded',
          result: ['timeout', 'malformed'].includes(mode)
            ? {}
            : { paymentComplete: mode === 'confirmed', setupComplete: true },
        }),
      })
    );
  }
});

it('rejects a production provider for a staging callback claim before sending', async () => {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    error: null,
    data:
      name === 'oxygen_callback_payment'
        ? {
            commandId: command,
            reference,
            status: 'queued',
            environment: 'staging',
          }
        : args.p_operation === 'claim'
          ? { reference, action: 'check_status', environment: 'staging' }
          : { recorded: true },
  }));
  const call = vi.fn();
  await expect(
    reconcileOxygenCallbackPayment(
      { rpc },
      () => ({ call, environment: 'production' }),
      workflow,
      command,
      reference
    )
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_payment_recovery',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({ outcome: 'failed' }),
    })
  );
});

it('rejects a previously succeeded result bound to another provider environment without replay', async () => {
  const rpc = vi.fn().mockResolvedValue({
    error: null,
    data: {
      commandId: command,
      reference,
      status: 'succeeded',
      environment: 'staging',
      result: { paymentComplete: true, setupComplete: true },
    },
  });
  const call = vi.fn();
  await expect(
    reconcileOxygenCallbackPayment(
      { rpc },
      () => ({ call, environment: 'production' }),
      workflow,
      command,
      reference
    )
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it('rejects a succeeded response with missing authoritative flags without replay', async () => {
  const rpc = vi.fn().mockResolvedValue({
    error: null,
    data: {
      commandId: command,
      reference,
      status: 'succeeded',
      environment: 'staging',
    },
  });
  const call = vi.fn();
  await expect(
    reconcileOxygenCallbackPayment(
      { rpc },
      () => ({ call, environment: 'staging' }),
      workflow,
      command,
      reference
    )
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
