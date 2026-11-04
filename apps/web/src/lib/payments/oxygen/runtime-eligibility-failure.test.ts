import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OxygenProviderFailure } from './provider';
import { performOxygenAction } from './runtime-service';

const id = '60000000-0000-4000-8000-000000000001';
const state = {
  applicationReference: id,
  validated: true,
  kyc: {
    bvn_status: 'DONE',
    nin_status: 'NOT_DONE',
    bank_status: 'NOT_DONE',
    phone_status: 'DONE',
    selfie_status: 'DONE',
    address_status: 'NOT_DONE',
  },
};
const context = {
  workflowId: id,
  stage: 'eligibility_required',
  version: 1,
  environment: 'staging',
  partnerReference: 'partner',
  merchantReference: null,
  orderId: id,
  productAmount: 400000,
  orderPhone: '08012345678',
  productName: 'Phone',
  address: 'Test Street',
  state,
};

it.each([
  ['not_sent', 'failed', 'eligibility_required'],
  ['indeterminate', 'failed', 'eligibility_required'],
  ['rejected', 'failed', 'eligibility_required'],
] as const)('persists eligibility %s as %s without another provider call', async (outcome, saved, stage) => {
  const workerCalls: Record<string, unknown>[] = [];
  const user = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) =>
      args.p_operation === 'status'
        ? {
            data: {
              workflowId: id,
              stage: 'eligibility_required',
              version: 1,
              environment: 'staging',
              state,
              executionEnabled: true,
              approvalOtpReady: false,
              activationEnabled: false,
              settlementEnabled: false,
            },
            error: null,
          }
        : { data: { commandId: id, status: 'queued' }, error: null }
    ),
  };
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      workerCalls.push(args);
      return args.p_operation === 'claim'
        ? {
            data: { context, command: { action: 'refresh_eligibility' } },
            error: null,
          }
        : { data: { recorded: true }, error: null };
    }),
  };
  const call = vi.fn(async () => {
    throw new OxygenProviderFailure(outcome);
  });
  await expect(
    performOxygenAction(
      user,
      async () => worker,
      { call },
      'partner',
      new Set(),
      {
        workflowId: id,
        version: 1,
        idempotencyKey: id,
        command: { action: 'refresh_eligibility' },
      }
    )
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledOnce();
  expect(workerCalls[1]).toMatchObject({
    p_command_id: id,
    p_outcome: saved,
    p_stage: stage,
  });
});

it('leaves a successful status read executing when its durable completion fails', async () => {
  const user = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data:
        args.p_operation === 'status'
          ? {
              workflowId: id,
              stage: 'eligibility_required',
              version: 1,
              environment: 'staging',
              state,
              executionEnabled: true,
              approvalOtpReady: false,
              activationEnabled: false,
              settlementEnabled: false,
            }
          : { commandId: id, status: 'queued' },
      error: null,
    })),
  };
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) =>
      args.p_operation === 'claim'
        ? {
            data: { context, command: { action: 'refresh_eligibility' } },
            error: null,
          }
        : { data: null, error: { message: 'durable completion unavailable' } }
    ),
  };
  const call = vi.fn(async () => ({
    loan_request_reference: id,
    partner_reference: 'partner',
    status: 'COMPLETED',
    is_eligible: true,
    eligible_amount: 500000,
    max_loan_amount: 500000,
    max_tenure: 6,
    message: 'Eligible',
  }));
  await expect(
    performOxygenAction(
      user,
      async () => worker,
      { call },
      'partner',
      new Set(),
      {
        workflowId: id,
        version: 1,
        idempotencyKey: id,
        command: { action: 'refresh_eligibility' },
      }
    )
  ).rejects.toThrow();
  expect(call).toHaveBeenCalledOnce();
  expect(
    worker.rpc.mock.calls.map(([name, args]) => [name, args.p_operation])
  ).toEqual([
    ['oxygen_runtime', 'claim'],
    ['oxygen_runtime', 'finish'],
  ]);
});
