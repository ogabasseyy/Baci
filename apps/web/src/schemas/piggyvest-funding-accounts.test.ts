import { describe, expect, it } from 'vitest';
import { piggyvestFundingAccountsSchemas } from './piggyvest-funding-accounts';

const account = {
  account_number: '0001234567',
  account_name: 'Synthetic Account',
  bank_name: 'Synthetic Bank',
  paypoint_name: null,
  paypoint_id: null,
};
const trustedIdentity = {
  environment: 'staging',
  integrationId: '00000000-0000-4000-8000-000000000001',
  merchantId: '00000000-0000-4000-8000-000000000002',
  customerId: '00000000-0000-4000-8000-000000000003',
  goalId: '00000000-0000-4000-8000-000000000004',
  providerWalletId: 'synthetic-wallet',
  providerCustomerId: 'synthetic-customer',
};

describe('piggyvestFundingAccountsSchemas', () => {
  it('projects only documented account fields and preserves leading zeroes and nulls', () => {
    expect(
      piggyvestFundingAccountsSchemas.response.parse({
        status: true,
        message: 'private provider text',
        data: [{ ...account, customer_email: 'private@example.test' }],
      })
    ).toEqual({ status: true, data: [account] });
  });

  it('accepts populated paypoint fields and an opaque provider ID', () => {
    const populated = {
      ...account,
      paypoint_name: 'Synthetic Paypoint',
      paypoint_id: 'opaque-paypoint',
    };
    expect(
      piggyvestFundingAccountsSchemas.response.parse({
        status: true,
        data: [populated],
      }).data
    ).toEqual([populated]);
  });

  it('accepts an empty account list as a valid pending response', () => {
    expect(
      piggyvestFundingAccountsSchemas.response.safeParse({
        status: true,
        data: [],
      }).success
    ).toBe(true);
  });

  it.each([
    { ...account, account_number: 1234567 },
    { ...account, account_number: '' },
    { ...account, account_number: 'x'.repeat(65) },
    { ...account, account_number: '123\n' },
    { ...account, account_name: '   ' },
    { ...account, account_name: 'x'.repeat(257) },
    { ...account, bank_name: '' },
    { ...account, bank_name: 'x'.repeat(257) },
    { ...account, paypoint_name: undefined },
    { ...account, paypoint_id: undefined },
    { ...account, paypoint_name: 'x'.repeat(257) },
    { ...account, paypoint_id: 'x'.repeat(513) },
  ])('rejects malformed or unbounded account projections', (invalidAccount) => {
    expect(
      piggyvestFundingAccountsSchemas.response.safeParse({
        status: true,
        data: [invalidAccount],
      }).success
    ).toBe(false);
  });

  it.each([
    { status: false, data: [] },
    { status: true, data: null },
    { status: true, data: Array.from({ length: 33 }, () => account) },
  ])('rejects failed envelopes and excessive account counts', (input) => {
    expect(
      piggyvestFundingAccountsSchemas.response.safeParse(input).success
    ).toBe(false);
  });

  it('accepts the complete private staging identity', () => {
    expect(
      piggyvestFundingAccountsSchemas.trustedIdentity.parse(trustedIdentity)
    ).toEqual(trustedIdentity);
  });

  it.each([
    { ...trustedIdentity, environment: 'production' },
    { ...trustedIdentity, merchantId: 'body-merchant' },
    { ...trustedIdentity, customerId: undefined },
    { ...trustedIdentity, goalId: undefined },
    { ...trustedIdentity, providerCustomerId: '' },
    { ...trustedIdentity, extra: true },
    { ...trustedIdentity, providerWalletId: 'x'.repeat(513) },
  ])('rejects incomplete or non-staging trusted identities', (input) => {
    expect(
      piggyvestFundingAccountsSchemas.trustedIdentity.safeParse(input).success
    ).toBe(false);
  });
});
