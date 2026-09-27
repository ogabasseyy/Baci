import { describe, expect, it } from 'vitest';
import {
  getCreditedAmountPaid,
  getImmediateEmailAmountDue,
} from './invoice-credit';

describe('invoice-credit amounts', () => {
  it('takes the larger of the recorded payment and wallet/savings use', () => {
    expect(
      getCreditedAmountPaid({ id: 'o1', amount_paid: 3000 }, 1000, 1000)
    ).toBe(3000);
    expect(getCreditedAmountPaid({ id: 'o1' }, 1000, 2500)).toBe(3500);
  });

  it('treats missing amounts as zero', () => {
    expect(getCreditedAmountPaid({ id: 'o1' }, 0, 0)).toBe(0);
  });

  it('floors the email amount due at zero', () => {
    expect(getImmediateEmailAmountDue(5000, 2000)).toBe(3000);
    expect(getImmediateEmailAmountDue(2000, 5000)).toBe(0);
  });
});
