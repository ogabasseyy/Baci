import { describe, expect, it } from 'vitest';
import { customerSavingsNonpaymentSchemas as schemas } from './customer-savings-nonpayment';

describe('nonpayment savings schemas', () => {
  it('requires a merchant identifier', () => {
    expect(schemas.identifiers.safeParse({}).success).toBe(false);
    expect(schemas.identifiers.parse({ merchantSlug: ' ogabassey ' })).toEqual({
      merchantSlug: 'ogabassey',
    });
  });
  it('rejects missing user linkage even when an email matches', () => {
    expect(
      schemas.customer.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        merchant_id: '22222222-2222-4222-8222-222222222222',
        user_id: null,
        email: 'matching@example.com',
      }).success
    ).toBe(false);
  });
  it('does not coerce truthy flags into enabled savings', () => {
    expect(
      schemas.settingsRows.safeParse([{ customer_device_savings_enabled: 1 }])
        .success
    ).toBe(false);
    expect(
      schemas.settingsRows.safeParse([
        { customer_device_savings_enabled: null },
      ]).success
    ).toBe(true);
  });
});
