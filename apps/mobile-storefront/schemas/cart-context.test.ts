import { nativeCartContextSchema } from './cart-context';

const valid = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  principalId: 'subject-1',
  scope: 'session',
  cartId: null,
  exp: 1893456000,
};

describe('nativeCartContextSchema', () => {
  it('accepts a bootstrap context without a cart', () => {
    expect(nativeCartContextSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects unknown scopes and oversized principals', () => {
    expect(
      nativeCartContextSchema.safeParse({ ...valid, scope: 'admin' }).success
    ).toBe(false);
    expect(
      nativeCartContextSchema.safeParse({
        ...valid,
        principalId: 'x'.repeat(129),
      }).success
    ).toBe(false);
  });

  it('rejects non-integer expiry', () => {
    expect(
      nativeCartContextSchema.safeParse({ ...valid, exp: 1.5 }).success
    ).toBe(false);
  });
});
