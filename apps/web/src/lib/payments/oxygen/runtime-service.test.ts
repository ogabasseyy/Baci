import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OxygenPaymentOriginUnverifiedError } from './payment-origin-error';
import {
  oxygenRuntimeRpc,
  performOxygenAction,
  readOxygenSnapshot,
} from './runtime-service';

const id = '60000000-0000-4000-8000-000000000001';
it('requests the versioned eligibility reason on customer snapshot reads', async () => {
  const client = {
    rpc: async (_name: string, args: Record<string, unknown>) => ({
      data: {
        workflowId: id,
        stage: 'eligibility_required',
        version: 1,
        environment: 'staging',
        executionEnabled: true,
        state:
          (args.p_payload as { includeEligibilityFailureReason?: boolean })
            .includeEligibilityFailureReason === true
            ? {
                eligibilityStatus: 'failed',
                eligibilityFailureReason: 'financial_details_mismatch',
              }
            : { eligibilityStatus: 'failed' },
        approvalOtpReady: false,
        activationEnabled: false,
        settlementEnabled: false,
      },
      error: null,
    }),
  };

  const snapshot = await readOxygenSnapshot(client, id);
  expect(snapshot.state.eligibilityFailureReason).toBe(
    'financial_details_mismatch'
  );
});
it('maps only the exact payment-origin database guard to a safe recovery error', async () => {
  const client = {
    rpc: vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'oxygen_payment_origin_unverified' },
    }),
  };
  await expect(oxygenRuntimeRpc(client, 'enqueue', id)).rejects.toBeInstanceOf(
    OxygenPaymentOriginUnverifiedError
  );
  client.rpc.mockResolvedValue({
    data: null,
    error: { code: '23514', message: 'private provider details' },
  });
  await expect(oxygenRuntimeRpc(client, 'enqueue', id)).rejects.toThrow(
    'Workflow unavailable'
  );
});
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
it('marks an execution pause as a definitive rejection before enqueue', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      workflowId: id,
      stage: 'kyc_required',
      version: 1,
      environment: 'staging',
      executionEnabled: false,
      state: {},
      approvalOtpReady: false,
      activationEnabled: false,
      settlementEnabled: false,
    },
    error: null,
  });
  await expect(
    performOxygenAction(
      { rpc },
      vi.fn(),
      { call: vi.fn() },
      'partner',
      new Set(),
      {
        workflowId: id,
        version: 1,
        idempotencyKey: id,
        command: { action: 'refresh_kyc' },
      }
    )
  ).rejects.toMatchObject({ code: 'OXYGEN_ACTION_NOT_DISPATCHED' });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    'oxygen_runtime',
    expect.objectContaining({ p_operation: 'status' })
  );
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
