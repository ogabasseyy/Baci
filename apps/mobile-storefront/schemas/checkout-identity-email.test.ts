import { checkoutIdentityEmailSchema } from './checkout-identity-email';

describe('checkoutIdentityEmailSchema', () => {
  it('accepts a valid email address', () => {
    expect(
      checkoutIdentityEmailSchema.safeParse('buyer@example.com').success
    ).toBe(true);
  });

  it('rejects an invalid email address', () => {
    expect(checkoutIdentityEmailSchema.safeParse('not-an-email').success).toBe(
      false
    );
  });
});
