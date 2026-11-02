import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type OxygenProviderContext,
  oxygenKycSchema,
} from '@/schemas/oxygen-runtime';
import { executeOxygenAction } from './runtime-executor';

const app = '60000000-0000-4000-8000-000000000001';
const loan = '70000000-0000-4000-8000-000000000001';
const context: OxygenProviderContext = {
  workflowId: app,
  stage: 'booked',
  version: 1,
  environment: 'staging',
  partnerReference: 'partner',
  merchantReference: null,
  orderId: app,
  productAmount: 400000,
  orderPhone: '08012345678',
  productName: 'Phone',
  address: '1 Test Street',
  state: {
    applicationReference: app,
    bookingReference: loan,
    validated: true,
    kyc: {
      bvn_status: 'DONE',
      nin_status: 'DONE',
      bank_status: 'DONE',
      phone_status: 'DONE',
      selfie_status: 'DONE',
      address_status: 'NOT_DONE',
    },
  },
};
it('retains an eligibility service failure without treating it as pending or a decline, and clears stale terms', async () => {
  const call = vi.fn().mockResolvedValue({
    loan_request_reference: app,
    partner_reference: 'partner',
    status: 'FAILED',
    is_eligible: false,
    message: 'Failed to fetch loan history. Please try again later.',
  });
  const result = await executeOxygenAction(
    {
      ...context,
      stage: 'eligibility_required',
      state: {
        validated: true,
        kyc: context.state.kyc,
        applicationReference: app,
        eligible: true,
        eligibleAmount: 400000,
      },
    },
    { action: 'refresh_eligibility' },
    { call },
    new Set()
  );
  expect(result.state.eligibilityStatus).toBe('failed');
  expect(result.state.eligible).toBeUndefined();
  expect(result.state.eligibleAmount).toBeUndefined();
  expect(result.stage).toBe('eligibility_required');
  expect(JSON.stringify(result.state)).not.toContain('Failed to fetch');
});
it('replaces a failed eligibility status when Oxygen confirms eligibility on retry', async () => {
  const call = vi.fn().mockResolvedValue({
    loan_request_reference: app,
    partner_reference: 'partner',
    status: 'COMPLETED',
    is_eligible: true,
    message: 'Complete',
    eligible_amount: 400000,
    max_loan_amount: 400000,
    minimum_loan_amount: 10000,
    max_tenure: 6,
  });
  const result = await executeOxygenAction(
    {
      ...context,
      stage: 'eligibility_required',
      state: {
        validated: true,
        kyc: context.state.kyc,
        applicationReference: app,
        eligibilityStatus: 'failed',
      },
    },
    { action: 'refresh_eligibility' },
    { call },
    new Set()
  );
  expect(result.state.eligibilityStatus).toBe('completed');
  expect(result.state.eligible).toBe(true);
});

it.each([
  'PROCESSING',
  'COMPLETED',
])('keeps %s distinct from a service failure', async (status) => {
  const result = await executeOxygenAction(
    {
      ...context,
      stage: 'eligibility_required',
      state: {
        validated: true,
        kyc: context.state.kyc,
        applicationReference: app,
        eligibilityStatus: 'failed',
      },
    },
    { action: 'refresh_eligibility' },
    {
      call: vi.fn().mockResolvedValue({
        loan_request_reference: app,
        partner_reference: 'partner',
        status,
        is_eligible: false,
        message: 'Check result',
      }),
    },
    new Set()
  );
  expect(result.state.eligibilityStatus).toBe(
    status === 'COMPLETED' ? 'completed' : 'pending'
  );
  expect(result.state.eligible).toBe(
    status === 'COMPLETED' ? false : undefined
  );
});

it('blocks NIN before selfie completion at the server boundary', async () => {
  const call = vi.fn();
  await expect(
    executeOxygenAction(
      {
        ...context,
        stage: 'kyc_required',
        state: {
          ...context.state,
          bookingReference: undefined,
          eligible: true,
          kyc: {
            ...oxygenKycSchema.parse(context.state.kyc),
            selfie_status: 'NOT_DONE',
            nin_status: 'NOT_DONE',
          },
        },
      },
      { action: 'validate_nin' },
      { call },
      new Set()
    )
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it('rechecks selfie status before NIN and does not mutate when the provider status changed', async () => {
  const latest = {
    ...oxygenKycSchema.parse(context.state.kyc),
    selfie_status: 'NOT_DONE',
    nin_status: 'NOT_DONE',
  };
  const call = vi.fn().mockResolvedValue(latest);
  const result = await executeOxygenAction(
    {
      ...context,
      stage: 'kyc_required',
      state: {
        ...context.state,
        bookingReference: undefined,
        eligible: true,
        kyc: {
          ...oxygenKycSchema.parse(context.state.kyc),
          nin_status: 'NOT_DONE',
        },
      },
    },
    { action: 'validate_nin' },
    { call },
    new Set()
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith('kyc', expect.any(Object));
  expect(result.state.kyc?.selfie_status).toBe('NOT_DONE');
});
