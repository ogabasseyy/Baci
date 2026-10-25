import { expect, it } from 'vitest';
import {
  oxygenSavedPlanSelectionSchema,
  oxygenSavedPlansSchema,
} from './oxygen-saved-plans';

it('rejects arbitrary cache writes, missing selected references and private provider state', () => {
  expect(
    oxygenSavedPlanSelectionSchema.safeParse({
      workflowId: 'bad',
      bookingReference: 'bad',
      state: {},
    }).success
  ).toBe(false);
  expect(
    oxygenSavedPlansSchema.safeParse({
      plans: [],
      selectedReference: '60000000-0000-4000-8000-000000000001',
    }).success
  ).toBe(false);
});
it('accepts a cache miss without inventing a booking', () => {
  expect(
    oxygenSavedPlansSchema.parse({ plans: [], selectedReference: null })
  ).toEqual({ plans: [], selectedReference: null });
});
it('requires matching terms and reference and excludes private provider context', () => {
  const id = '60000000-0000-4000-8000-000000000001';
  const entry = {
    bookingReference: id,
    productAmount: 400000,
    equityPercentage: 25,
    tenure: 1,
    state: {
      bookingReference: id,
      booking: {
        loan_reference: id,
        status: 'BOOKED',
        product_amount: 400000,
        equity_percentage: 25,
        equity_amount: 100000,
        loan_amount: 300000,
        loan_tenure: 1,
      },
      quotedCharges: 5000,
      schedule: [
        {
          period: 1,
          dueDate: [2026, 11, 27],
          amount: 330000,
          principal: 300000,
          interest: 30000,
        },
      ],
    },
    updatedAt: '2026-10-23T12:00:00Z',
  };
  expect(
    oxygenSavedPlansSchema.safeParse({ plans: [entry], selectedReference: id })
      .success
  ).toBe(true);
  expect(
    oxygenSavedPlansSchema.safeParse({
      plans: [{ ...entry, equityPercentage: 50 }],
      selectedReference: id,
    }).success
  ).toBe(false);
  expect(
    oxygenSavedPlansSchema.safeParse({
      plans: [
        {
          ...entry,
          state: { ...entry.state, phone: 'private', activityToken: 'private' },
        },
      ],
      selectedReference: id,
    }).success
  ).toBe(false);
});
