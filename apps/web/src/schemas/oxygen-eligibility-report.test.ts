import { describe, expect, it } from 'vitest';
import { oxygenEligibilityReportSchema } from './oxygen-eligibility-report';

const base = {
  loan_request_reference: 'loan',
  partner_reference: 'partner',
  is_eligible: true,
  status: 'COMPLETED',
  message: 'Eligible',
};
describe('oxygenEligibilityReportSchema offers', () => {
  it('accepts omitted offers and valid monthly offers', () => {
    expect(oxygenEligibilityReportSchema.safeParse(base).success).toBe(true);
    expect(
      oxygenEligibilityReportSchema.safeParse({
        ...base,
        tenure_unit: 'Monthly',
        offers: [
          { loan_amount: 68000, tenor: 1 },
          { loan_amount: 189000, tenor: 3 },
        ],
      }).success
    ).toBe(true);
  });
  it('rejects invalid amounts, tenures and offer counts', () => {
    for (const offer of [
      { loan_amount: 0, tenor: 1 },
      { loan_amount: -1, tenor: 1 },
      { loan_amount: Number.MAX_SAFE_INTEGER, tenor: 1 },
      { loan_amount: 68000, tenor: 0 },
      { loan_amount: 68000, tenor: 13 },
      { loan_amount: 68000, tenor: 1.5 },
    ]) {
      expect(
        oxygenEligibilityReportSchema.safeParse({ ...base, offers: [offer] })
          .success
      ).toBe(false);
    }
    expect(
      oxygenEligibilityReportSchema.safeParse({ ...base, offers: [] }).success
    ).toBe(false);
    expect(
      oxygenEligibilityReportSchema.safeParse({
        ...base,
        offers: Array(13).fill({ loan_amount: 68000, tenor: 1 }),
      }).success
    ).toBe(false);
  });
});
