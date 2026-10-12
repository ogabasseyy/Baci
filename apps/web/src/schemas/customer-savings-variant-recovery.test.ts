import { describe, expect, it } from 'vitest';
import { customerSavingsVariantRecoverySchema } from './customer-savings-variant-recovery';

const request = {
  merchantSlug: 'ogabassey',
  goalId: '00000000-0000-4000-8000-000000000001',
  variantId: '00000000-0000-4000-8000-000000000002',
};

describe('customerSavingsVariantRecoverySchema', () => {
  it('accepts an exact variant and merchant context', () => {
    expect(
      customerSavingsVariantRecoverySchema.safeParse(request).success
    ).toBe(true);
  });

  it.each([
    { ...request, variantId: null },
    { ...request, goalId: 'invalid' },
    { ...request, merchantSlug: undefined },
    { ...request, targetAmount: 1 },
    { ...request, customerId: 'someone-else' },
  ])('rejects missing identity or client-authoritative fields: %j', (input) => {
    expect(customerSavingsVariantRecoverySchema.safeParse(input).success).toBe(
      false
    );
  });
});
