// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { OxygenProviderContext } from '@/schemas/oxygen-runtime';
import { oxygenRuntimeActionSchema } from '@/schemas/oxygen-runtime';
import { bookOxygenPlan } from './runtime-booking';
import { oxygenActionAllowed } from './runtime-policy';

const id = '60000000-0000-4000-8000-000000000001';
const booking = {
  loan_reference: id,
  status: 'BOOKED' as const,
  product_amount: 400000,
  equity_percentage: 35,
  equity_amount: 140000,
  loan_amount: 260000,
  loan_tenure: 3,
};
const context: OxygenProviderContext = {
  workflowId: id,
  orderId: id,
  version: 1,
  stage: 'approval_required',
  environment: 'staging',
  partnerReference: 'partner',
  merchantReference: null,
  productAmount: 400000,
  orderPhone: '08012345678',
  productName: 'Test',
  address: 'Test address',
  state: {
    applicationReference: id,
    bookingReference: id,
    phone: '2348012345678',
    validated: true,
    eligible: true,
    eligibleAmount: 400000,
    minimumAmount: 10000,
    maxTenure: 12,
    kyc: {
      bvn_status: 'DONE',
      nin_status: 'DONE',
      bank_status: 'DONE',
      phone_status: 'DONE',
      selfie_status: 'DONE',
      address_status: 'DONE',
    },
    booking,
    quotedCharges: 5000,
    schedule: [
      {
        period: 1,
        dueDate: [2026, 11, 27],
        principal: 260000,
        interest: 10000,
        amount: 270000,
      },
    ],
  },
};
const action = { action: 'book' as const, equityPercentage: 35, tenure: 6 };
it('allows a changed tenure on an unapproved booking but rejects duplicate, approved, OTP-active and uncertain bookings', () => {
  expect(oxygenActionAllowed(context, action)).toBe(true);
  expect(oxygenActionAllowed(context, { ...action, tenure: 3 })).toBe(false);
  expect(
    oxygenActionAllowed(
      { ...context, stage: 'reconciliation_required' },
      action
    )
  ).toBe(false);
  expect(
    oxygenActionAllowed(
      { ...context, state: { ...context.state, activityToken: 'synthetic' } },
      action
    )
  ).toBe(false);
  expect(
    oxygenActionAllowed(
      {
        ...context,
        state: {
          ...context.state,
          booking: { ...booking, status: 'APPROVED' },
        },
      },
      action
    )
  ).toBe(false);
});
it('clears old charges and installments before storing a new booking reference', async () => {
  const state = structuredClone(context.state);
  const call = vi.fn().mockResolvedValue({ ...booking, loan_tenure: 6 });
  await bookOxygenPlan(context, state, action, { call });
  expect(state.schedule).toBeUndefined();
  expect(state.quotedCharges).toBeUndefined();
  expect(state.activityToken).toBeUndefined();
  expect(call).toHaveBeenCalledTimes(1);
  expect(state.booking?.loan_tenure).toBe(6);
});
it('rejects more than two percentage decimals instead of silently rounding them', () => {
  expect(
    oxygenRuntimeActionSchema.safeParse({
      ...action,
      equityPercentage: 35.250049,
    }).success
  ).toBe(false);
  expect(
    oxygenRuntimeActionSchema.safeParse({ ...action, equityPercentage: 37.25 })
      .success
  ).toBe(true);
});
