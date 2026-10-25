import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { performOxygenAction } from './runtime-service';

const id = '60000000-0000-4000-8000-000000000001';
it('requires ownership and readiness before worker login or provider calls', async () => {
  const worker = vi.fn();
  const call = vi.fn();
  await expect(
    performOxygenAction(
      { rpc: async () => ({ data: null, error: { code: '42501' } }) },
      worker,
      { call },
      'partner',
      new Set(),
      {
        workflowId: id,
        version: 0,
        idempotencyKey: id,
        command: { action: 'refresh_kyc' },
      }
    )
  ).rejects.toThrow('Workflow unavailable');
  expect(worker).not.toHaveBeenCalled();
  expect(call).not.toHaveBeenCalled();
});
it.each([
  false,
  true,
])('releases read failures and invalid claimed context without locking (%s)', async (invalidContext) => {
  const calls: unknown[] = [];
  const user = {
    rpc: async (_name: string, args: Record<string, unknown>) =>
      args.p_operation === 'status'
        ? {
            data: {
              workflowId: id,
              stage: 'kyc_required',
              version: 0,
              environment: 'staging',
              executionEnabled: true,
              state: { applicationReference: id },
              approvalOtpReady: false,
              activationEnabled: false,
              settlementEnabled: false,
            },
            error: null,
          }
        : { data: { commandId: id, status: 'queued' }, error: null },
  };
  const worker = {
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      return args.p_operation === 'claim'
        ? {
            data: {
              context: {
                workflowId: id,
                stage: 'kyc_required',
                version: 0,
                environment: 'staging',
                partnerReference: 'partner',
                merchantReference: null,
                orderId: id,
                productAmount: 400000,
                orderPhone: '08012345678',
                productName: 'Order 1',
                address: invalidContext ? 'x'.repeat(1001) : 'Street',
                state: { applicationReference: id },
              },
              command: { action: 'refresh_kyc' },
            },
            error: null,
          }
        : { data: { recorded: true }, error: null };
    },
  };
  await expect(
    performOxygenAction(
      user,
      async () => worker,
      {
        call: async () => {
          throw new Error('secret upstream');
        },
      },
      'partner',
      new Set(),
      {
        workflowId: id,
        version: 0,
        idempotencyKey: id,
        command: { action: 'refresh_kyc' },
      }
    )
  ).rejects.toThrow('Action failed; please check the details and try again');
  expect(calls[1]).toMatchObject({
    p_command_id: id,
    p_outcome: 'failed',
    p_stage: 'kyc_required',
    p_diagnostic: expect.objectContaining({
      kind: 'validation',
      outcome: 'not_sent',
    }),
  });
});
