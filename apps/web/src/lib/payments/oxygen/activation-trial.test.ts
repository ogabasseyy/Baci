import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runOxygenActivationTrial } from './activation-trial';

it.each([
  'activated',
  'unpaid',
  'setup_incomplete',
  'malformed',
  'rejected',
  'timeout',
])('makes at most one activation attempt and retains its outcome (%s)', async (mode) => {
  const rpc = vi
    .fn()
    .mockImplementation(
      async (_name: string, args: Record<string, unknown>) => ({
        error: null,
        data:
          args.p_operation === 'enqueue' || args.p_operation === 'claim'
            ? {
                status: 'executing',
                reference: '438f96ee-37c4-49bb-a56c-51451f9cb624',
              }
            : { recorded: true },
      })
    );
  const request = vi.fn(async (operation: string) => {
    if (operation === 'payment')
      return Response.json({
        split_payment: { completed: mode !== 'unpaid' },
        repayment_setup: { completed: mode !== 'setup_incomplete' },
      });

    if (mode === 'timeout') throw new Error('timeout');
    return Response.json(
      mode === 'malformed'
        ? {}
        : mode === 'rejected'
          ? { message: 'Unable to activate' }
          : {
              loan_reference: '438f96ee-37c4-49bb-a56c-51451f9cb624',
              status: 'ACTIVATED',
              loan_amount: 297000,
            },
      { status: mode === 'rejected' ? 400 : 200 }
    );
  });
  await runOxygenActivationTrial({ rpc }, { rpc }, request, 'a'.repeat(64));
  const activations = request.mock.calls.filter(
    (call) => call[0] === 'activate'
  );
  expect(activations).toHaveLength(
    ['unpaid', 'setup_incomplete'].includes(mode) ? 0 : 1
  );
  expect(rpc).toHaveBeenCalledWith(
    'oxygen_activation_trial',
    expect.objectContaining({
      p_operation: 'finish',
      p_payload: expect.objectContaining({
        status:
          mode === 'activated'
            ? 'activated'
            : ['timeout', 'malformed'].includes(mode)
              ? 'indeterminate'
              : 'rejected',
      }),
    })
  );
  expect(
    rpc.mock.calls.filter((call) => call[1].p_operation === 'evidence').length
  ).toBeGreaterThan(0);
});
it('does not repeat a claimed or completed trial', async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: null });
  const request = vi.fn();
  await runOxygenActivationTrial({ rpc }, { rpc }, request, 'a'.repeat(64));
  expect(request).not.toHaveBeenCalled();
});
