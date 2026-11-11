import { describe, expect, it } from 'vitest';
import type { OxygenProviderState } from '@/schemas/oxygen-runtime';
import { bookedPlanIsOffered } from './booked-plan-offer';

const state = {
  eligibleAmount: 189000,
  minimumAmount: 68000,
  maxTenure: 3,
  offers: [{ tenure: 3, loanAmount: 189000 }],
  booking: {
    status: 'BOOKED',
    loan_reference: 'loan',
    product_amount: 198000,
    equity_amount: 49500,
    equity_percentage: 25,
    loan_amount: 148500,
    loan_tenure: 3,
  },
} satisfies OxygenProviderState;
describe('bookedPlanIsOffered', () => {
  it('rejects missing fields, mismatched tenures, and a tenure beyond the maximum', () => {
    expect(bookedPlanIsOffered({ ...state, eligibleAmount: undefined })).toBe(
      false
    );
    expect(bookedPlanIsOffered({ ...state, minimumAmount: undefined })).toBe(
      false
    );
    expect(bookedPlanIsOffered({ ...state, maxTenure: undefined })).toBe(false);
    expect(
      bookedPlanIsOffered({
        ...state,
        offers: [{ tenure: 2, loanAmount: 189000 }],
      })
    ).toBe(false);
    expect(bookedPlanIsOffered({ ...state, maxTenure: 2 })).toBe(false);
  });
  it('checks inclusive minimum and lower of the overall and per-tenure maximum', () => {
    for (const [amount, allowed] of [
      [67999, false],
      [68000, true],
      [189000, true],
      [189001, false],
    ] as const) {
      expect(
        bookedPlanIsOffered({
          ...state,
          booking: { ...state.booking, loan_amount: amount },
        })
      ).toBe(allowed);
    }
    expect(bookedPlanIsOffered({ ...state, eligibleAmount: 100000 })).toBe(
      false
    );
  });
  it('fails closed rather than throwing on excess precision', () => {
    expect(
      bookedPlanIsOffered({
        ...state,
        booking: { ...state.booking, loan_amount: 148500.001 },
      })
    ).toBe(false);
    expect(
      bookedPlanIsOffered({
        ...state,
        offers: [{ tenure: 3, loanAmount: 188999.999 }],
      })
    ).toBe(false);
  });
});
