// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOxygenProvider } from './provider';
import { quoteOxygenPlan } from './quote-plan';

const id = '60000000-0000-4000-8000-000000000001';
const reference = '70000000-0000-4000-8000-000000000001';
const kyc = {
  bvn_status: 'DONE',
  nin_status: 'DONE',
  bank_status: 'DONE',
  phone_status: 'DONE',
  selfie_status: 'DONE',
  address_status: 'DONE',
};

it.each([
  'book',
  'refresh_details',
] as const)('rejects a staging %s claim for a production adapter before contacting Oxygen', async (action) => {
  const state = {
    applicationReference: id,
    validated: true,
    eligible: true,
    minimumAmount: 10000,
    eligibleAmount: 400000,
    maxTenure: 12,
    kyc,
    bookingReference: reference,
    booking: {
      loan_reference: reference,
      product_amount: 400000,
      equity_percentage: 35,
      equity_amount: 140000,
      loan_amount: 260000,
      loan_tenure: action === 'book' ? 3 : 6,
      status: 'BOOKED',
    },
  };
  const snapshot = {
    workflowId: id,
    stage: 'approval_required',
    environment: 'staging',
    version: 3,
    executionEnabled: true,
    approvalOtpReady: false,
    activationEnabled: false,
    settlementEnabled: false,
    state,
  };
  const requested =
    action === 'book'
      ? { action, equityPercentage: 35, tenure: 6 }
      : { action };
  const user = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({
      error: null,
      data:
        name === 'oxygen_saved_plans'
          ? { plans: [], selectedReference: null }
          : args.p_operation === 'status'
            ? snapshot
            : { commandId: id, status: 'queued' },
    })),
  };
  const worker = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      error: null,
      data:
        args.p_operation === 'claim'
          ? {
              command: requested,
              context: {
                workflowId: id,
                orderId: id,
                stage: snapshot.stage,
                version: 3,
                environment: 'staging',
                partnerReference: 'partner',
                merchantReference: null,
                productAmount: 400000,
                orderPhone: '08012345678',
                productName: 'Phone',
                address: 'Street',
                state: { ...state, phone: '2348012345678' },
              },
            }
          : { recorded: true },
    })),
  };
  const token = vi.fn().mockResolvedValue('synthetic');
  const fetch = vi
    .fn()
    .mockRejectedValue(new Error('unexpected provider request'));
  const adapter = createOxygenProvider({
    environment: 'production',
    token,
    fetch,
  });
  const forCommand = vi.fn().mockReturnValue(adapter);
  await expect(
    quoteOxygenPlan(
      user,
      {
        provider: { ...adapter, forCommand },
        worker: async () => worker,
        partnerReference: 'partner',
        hosts: new Set(),
      },
      { workflowId: id, idempotencyKey: id, equityPercentage: 35, tenure: 6 }
    )
  ).rejects.toThrow('Action failed; please check the details and try again');
  expect(forCommand).toHaveBeenCalledOnce();
  expect(token).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(worker.rpc).toHaveBeenCalledWith(
    'oxygen_finish_failure',
    expect.objectContaining({
      p_outcome: 'failed',
      p_diagnostic: expect.objectContaining({ outcome: 'not_sent' }),
    })
  );
});
