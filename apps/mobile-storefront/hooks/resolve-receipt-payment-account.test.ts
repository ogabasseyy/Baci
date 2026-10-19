import { describe, expect, it } from '@jest/globals';
import { resolveReceiptPaymentAccount } from './resolve-receipt-payment-account';

const historicalPaystackAccount = {
  account_name: 'Paid DVA',
  account_number: '1111111111',
  assigned_at: '2026-07-08T11:00:00.000Z',
  bank_name: 'Paystack',
  created_at: '2026-07-08T11:00:00.000Z',
  expires_at: '2026-07-08T12:30:00.000Z',
  provider: 'paystack',
};

const newerPaystackAccount = {
  account_name: 'Newer DVA',
  account_number: '2222222222',
  assigned_at: '2026-07-08T12:00:00.000Z',
  bank_name: 'Paystack',
  created_at: '2026-07-08T12:00:00.000Z',
  expires_at: '2026-07-08T13:30:00.000Z',
  provider: 'paystack',
};

describe('resolveReceiptPaymentAccount', () => {
  it('uses the successful paid transaction receiver when aliases are historical', () => {
    const account = resolveReceiptPaymentAccount(
      [historicalPaystackAccount, newerPaystackAccount],
      [
        {
          created_at: '2026-07-08T12:45:00.000Z',
          gateway: 'paystack',
          metadata: { dva_account_number: '1111111111' },
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      'paid',
      new Date('2026-07-08T13:00:00.000Z')
    );

    expect(account?.account_number).toBe('1111111111');
  });

  it('does not use an unsuccessful transaction receiver for a paid receipt', () => {
    const account = resolveReceiptPaymentAccount(
      [historicalPaystackAccount, newerPaystackAccount],
      [
        {
          created_at: '2026-07-08T12:45:00.000Z',
          gateway: 'paystack',
          metadata: { dva_account_number: '1111111111' },
          status: 'pending',
          transaction_type: 'payment',
        },
      ],
      'paid',
      new Date('2026-07-08T13:00:00.000Z')
    );

    expect(account?.account_number).toBe('2222222222');
  });

  it('does not keep an expired Paystack alias on an unpaid document', () => {
    const account = resolveReceiptPaymentAccount(
      [
        historicalPaystackAccount,
        {
          account_name: 'Legacy account',
          account_number: '3333333333',
          bank_name: 'Korapay',
          created_at: '2026-07-08T12:00:00.000Z',
          provider: 'korapay',
        },
      ],
      [],
      'unpaid',
      new Date('2026-07-08T13:00:00.000Z')
    );

    expect(account?.account_number).toBe('3333333333');
  });
});
