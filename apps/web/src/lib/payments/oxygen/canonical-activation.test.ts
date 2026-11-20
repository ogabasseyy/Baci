import { oxygenOrderPlanSchema } from '@baci/shared/schemas/oxygen-order-plan';
import { expect, it } from 'vitest';
import {
  oxygenCustomerProviderStateSchema,
  oxygenProviderStateSchema,
} from '@/schemas/oxygen-runtime';

it('retains an ACTIVATED provider booking when the canonical workflow is reopened', () => {
  const reference = '1e65cf4b-4942-4ade-8149-e894687f6c40';
  const state = {
    bookingReference: reference,
    paymentComplete: true,
    setupComplete: true,
    booking: {
      loan_reference: reference,
      status: 'ACTIVATED',
      product_amount: 198000,
      loan_amount: 148500,
      equity_amount: 49500,
      equity_percentage: 25,
      loan_tenure: 3,
    },
  };
  expect(oxygenProviderStateSchema.parse(state)).toEqual(state);
});
it('carries confirmed financing separately from merchant settlement in order history', () => {
  expect(
    oxygenOrderPlanSchema.parse({
      upfront: 52432.88,
      upfrontConfirmed: true,
      activationConfirmed: true,
      months: 3,
      schedule: [],
    }).activationConfirmed
  ).toBe(true);
});

it.each([
  { loan_tenure: 0 },
  { loan_tenure: 1.5 },
  { total_upfront_payment: -1 },
  { total_upfront_payment: Number.POSITIVE_INFINITY },
])('rejects invalid booking metadata at the customer snapshot boundary %#', (invalid) => {
  const state = {
    booking: {
      loan_reference: '1e65cf4b-4942-4ade-8149-e894687f6c40',
      status: 'ACTIVATED',
      product_amount: 198000,
      loan_amount: 148500,
      equity_amount: 49500,
      equity_percentage: 25,
      loan_tenure: 3,
      ...invalid,
    },
  };
  expect(oxygenCustomerProviderStateSchema.safeParse(state).success).toBe(
    false
  );
});
