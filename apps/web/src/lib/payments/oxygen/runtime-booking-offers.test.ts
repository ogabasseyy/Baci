import { expect, it, vi } from 'vitest';
import type {
  OxygenProviderContext,
  OxygenProviderState,
} from '@/schemas/oxygen-runtime';
import { bookOxygenPlan } from './runtime-booking';

const context = {
  productAmount: 198000,
  address: 'Test address',
  partnerReference: 'partner',
  productName: 'Test',
} as OxygenProviderContext;
const state = {
  minimumAmount: 68000,
  eligibleAmount: 189000,
  maxTenure: 3,
  applicationReference: 'application',
  phone: '2348000000000',
  offers: [
    { tenure: 1, loanAmount: 68000 },
    { tenure: 2, loanAmount: 131000 },
    { tenure: 3, loanAmount: 189000 },
  ],
} as OxygenProviderState;

it('rejects a principal above the selected period limit before calling Oxygen', async () => {
  const call = vi.fn();
  await expect(
    bookOxygenPlan(
      context,
      state,
      {
        action: 'book',
        equityPercentage: 25,
        tenure: 1,
      },
      { call }
    )
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
it('allows the same principal for the three-month offer', async () => {
  const call = vi.fn().mockResolvedValue({
    loan_reference: '11111111-1111-4111-8111-111111111111',
    product_amount: 198000,
    loan_amount: 148500,
    equity_percentage: 25,
    equity_amount: 49500,
    loan_tenure: 3,
    status: 'BOOKED',
  });
  const current = structuredClone(state);
  await bookOxygenPlan(
    context,
    current,
    { action: 'book', equityPercentage: 25, tenure: 3 },
    { call }
  );
  expect(call).toHaveBeenCalledOnce();
  expect(current.booking?.loan_tenure).toBe(3);
});
it.each([
  { ...state, offers: undefined },
  { ...state, offers: [{ tenure: 2, loanAmount: 189000 }] },
])('does not book when the selected offer is unavailable', async (current) => {
  const call = vi.fn();
  await expect(
    bookOxygenPlan(
      context,
      current,
      {
        action: 'book',
        equityPercentage: 25,
        tenure: 3,
      },
      { call }
    )
  ).rejects.toThrow();
  expect(call).not.toHaveBeenCalled();
});
