import { expect, it } from 'vitest';
import { oxygenOrderPlanSchema } from '@/schemas/oxygen-order-plan';
import { oxygenProviderStateSchema } from '@/schemas/oxygen-runtime';

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
