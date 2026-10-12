import { describe, expect, it } from 'vitest';
import { piggyvestCustomerFundingViewSchemas } from './piggyvest-customer-funding-view';

describe('piggyvestCustomerFundingViewSchemas', () => {
  it.each([
    'pending',
    'unavailable',
  ])('accepts a metadata-free %s view', (status) => {
    expect(piggyvestCustomerFundingViewSchemas.view.parse({ status })).toEqual({
      status,
    });
  });

  it('accepts only the three funding display fields on ready accounts', () => {
    const view = {
      status: 'ready',
      accounts: [
        {
          accountNumber: '0001234567',
          accountName: 'Synthetic account',
          bankName: 'Synthetic bank',
        },
      ],
    };
    expect(piggyvestCustomerFundingViewSchemas.view.parse(view)).toEqual(view);
  });

  it.each([
    { status: 'ready', accounts: [] },
    { status: 'pending', accounts: [] },
    { status: 'unavailable', error: 'private error' },
    {
      status: 'ready',
      accounts: [
        {
          accountNumber: '123',
          accountName: 'Account',
          bankName: 'Bank',
          providerWalletId: 'private',
        },
      ],
    },
    {
      status: 'ready',
      accounts: [
        { accountNumber: '123\n', accountName: 'Account', bankName: 'Bank' },
      ],
    },
    {
      status: 'ready',
      accounts: Array.from({ length: 33 }, () => ({
        accountNumber: '123',
        accountName: 'Account',
        bankName: 'Bank',
      })),
    },
  ])('rejects malformed or overexposed projection', (view) => {
    expect(
      piggyvestCustomerFundingViewSchemas.view.safeParse(view).success
    ).toBe(false);
  });
});
