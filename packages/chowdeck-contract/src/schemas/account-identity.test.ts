import { accountIdentitySchema } from './account-identity';

describe('account identity schema', () => {
  it('parses the closed normalized identity tuple', () => {
    const identity = {
      domain: 'merchant.example.com',
      vendorId: 'vendor-123',
      currency: 'NGN',
    };

    expect(accountIdentitySchema.parse(identity)).toEqual(identity);
  });

  it('rejects uppercase codes absent from the current official ISO 4217 list', () => {
    expect(
      accountIdentitySchema.safeParse({
        domain: 'merchant.example.com',
        vendorId: 'vendor-123',
        currency: 'ZZZ',
      }).success
    ).toBe(false);
  });
});
