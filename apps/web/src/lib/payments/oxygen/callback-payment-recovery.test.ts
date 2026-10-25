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
  'busy',
])('records callback status independently without approval or link mutations (%s)', async (mode) => {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    error: null,
    data:
      name === 'oxygen_callback_payment'
        ? {
            commandId: command,
            reference,
            status:
              mode === 'duplicate'
                ? 'succeeded'
                : mode === 'busy'
                  ? 'executing'
                  : 'queued',
          }
        : args.p_operation === 'claim'
          ? { reference, action: 'check_status' }
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
  else await run;
  if (['duplicate', 'busy'].includes(mode)) expect(call).not.toHaveBeenCalled();
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
