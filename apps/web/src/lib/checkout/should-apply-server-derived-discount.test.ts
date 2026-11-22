import { describe, expect, it } from 'vitest';
import { shouldApplyServerDerivedDiscount } from './should-apply-server-derived-discount';

const base = {
  redvaultRequested: false,
  merchantCanAutoNegotiate: true,
  requestedDiscountCode: undefined,
  expectedTotal: 1000,
  source: 'web',
};

describe('shouldApplyServerDerivedDiscount', () => {
  it('applies for an entitled merchant with an expected total', () => {
    expect(shouldApplyServerDerivedDiscount(base)).toBe(true);
  });

  it('applies for the mobile app even without an expected total', () => {
    expect(
      shouldApplyServerDerivedDiscount({
        ...base,
        expectedTotal: undefined,
        source: 'mobile_app',
      })
    ).toBe(true);
  });

  it.each([
    ['redvault', { redvaultRequested: true }],
    ['not entitled', { merchantCanAutoNegotiate: false }],
    ['discount code', { requestedDiscountCode: 'SAVE10' }],
    ['no expected total on web', { expectedTotal: undefined }],
  ])('does not apply when %s', (_name, override) => {
    expect(shouldApplyServerDerivedDiscount({ ...base, ...override })).toBe(
      false
    );
  });
});
