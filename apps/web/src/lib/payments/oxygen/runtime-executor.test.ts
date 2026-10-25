import { describe, expect, it, vi } from 'vitest';

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
describe('provider workflow execution', () => {
  it('queries Oxygen instead of trusting callback completion fields', async () => {
    const call = vi.fn().mockResolvedValue({
      split_payment: { completed: true },
      repayment_setup: { completed: false },
    });
    const result = await executeOxygenAction(
      {
        ...context,
        stage: 'payment_required',
        state: {
          ...context.state,
          booking: {
            loan_reference: loan,
            product_amount: 400000,
            loan_amount: 260000,
            equity_percentage: 35,
            equity_amount: 140000,
            loan_tenure: 3,
            status: 'APPROVED',
          },
        },
      },
      { action: 'refresh_payment_setup' },
      { call },
      new Set()
    );
    expect(call).toHaveBeenCalledWith('payment', { loan_reference: loan });
    expect(result.stage).toBe('payment_required');
    expect(result.state.setupComplete).toBe(false);
  });
  it('does not trigger approval OTP until address is verified', async () => {
    const call = vi.fn();
    await expect(
      executeOxygenAction(
        context,
        { action: 'trigger_approval_otp' },
        { call },
        new Set()
      )
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
  it('submits a real image and keeps it out of saved state', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ message: 'Address submitted successfully!' });
    const result = await executeOxygenAction(
      context,
      {
        action: 'submit_address',
        state: 'Lagos',
        lga: 'Ikeja',
        city: 'Ikeja',
        street: 'Street',
        landmark: 'Mall',
        house_number: '1',
      },
      { call },
      new Set(),
      {
        name: 'bill.jpg',
        type: 'image/jpeg',
        bytes: new Uint8Array([255, 216, 255, 224]),
      }
    );
    expect(call.mock.calls[0][1]).toMatchObject({
      loan_request_reference: app,
      partner_reference: 'partner',
      content_type: 'image/jpeg',
      residency_document: '/9j/4A==',
    });
    expect(JSON.stringify(result.state)).not.toContain('residency_document');
    expect(result.stage).toBe('booked');
  });
  it('rejects mismatched booking amounts and foreign hosted links', async () => {
    const call = vi.fn().mockResolvedValue({
      loan_reference: loan,
      product_amount: 400001,
      loan_amount: 260000,
      equity_percentage: 35,
      equity_amount: 140000,
      loan_tenure: 3,
      status: 'BOOKED',
    });
    await expect(
      executeOxygenAction(
        {
          ...context,
          stage: 'plan_required',
          state: {
            ...context.state,
            bookingReference: undefined,
            eligible: true,
            eligibleAmount: 400000,
            minimumAmount: 10000,
            maxTenure: 12,
          },
        },
        { action: 'book', equityPercentage: 35, tenure: 3 },
        { call },
        new Set()
      )
    ).rejects.toThrow();
  });
  it('never reaches activation when both setup flags become complete', async () => {
    const call = vi.fn().mockResolvedValue({
      split_payment: { completed: true },
      repayment_setup: { completed: true },
    });
    const result = await executeOxygenAction(
      {
        ...context,
        stage: 'payment_required',
        state: {
          ...context.state,
          booking: {
            loan_reference: loan,
            product_amount: 400000,
            loan_amount: 260000,
            equity_percentage: 35,
            equity_amount: 140000,
            loan_tenure: 3,
            status: 'APPROVED',
          },
        },
      },
      { action: 'refresh_payment_setup' },
      { call },
      new Set()
    );
    expect(result.stage).toBe('ready_for_activation');
    expect(call).toHaveBeenCalledTimes(1);
  });
});

it('blocks approval when the checkout price changed after booking', async () => {
  const call = vi.fn();
  await expect(
    executeOxygenAction(
      {
        ...context,
        stage: 'approval_required',
        productAmount: 410000,
        state: {
          ...context.state,
          booking: {
            loan_reference: loan,
            product_amount: 400000,
            loan_amount: 260000,
            equity_percentage: 35,
            equity_amount: 140000,
            loan_tenure: 3,
            status: 'BOOKED',
          },
          kyc: {
            bvn_status: 'DONE',
            nin_status: 'DONE',
            bank_status: 'DONE',
            phone_status: 'DONE',
            selfie_status: 'DONE',
            address_status: 'DONE',
          },
        },
      },
      { action: 'trigger_approval_otp' },
      { call },
      new Set()
    )
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});

it.each([
  'message',
  'Message',
])('accepts the known %s resend acknowledgment without recreating the application', async (key) => {
  const call = vi
    .fn()
    .mockResolvedValue({ [key]: 'OTP retriggered for validation' });
  await executeOxygenAction(
    {
      ...context,
      stage: 'eligibility_required',
      state: {
        applicationReference: app,
        phone: '2348012345678',
        customerPath: 'existing',
        validated: false,
      },
    },
    { action: 'resend_customer_otp' } as never,
    { call },
    new Set()
  );
  expect(call).toHaveBeenCalledWith('resend_existing', {
    loan_request_reference: app,
    partner_reference: 'partner',
  });
  expect(call).toHaveBeenCalledTimes(1);
});

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
