import { describe, expect, it } from 'vitest';
import { getPaystackDvaAccountNumberFromTransactions } from './get-paystack-dva-account-number';

describe('getPaystackDvaAccountNumberFromTransactions', () => {
  it('uses the latest successful Paystack transaction receiver', () => {
    const accountNumber = getPaystackDvaAccountNumberFromTransactions([
      {
        created_at: '2026-08-27T10:00:00.000Z',
        gateway: 'paystack',
        metadata: { dva_account_number: '1111111111' },
        status: 'completed',
        transaction_type: 'payment',
      },
      {
        created_at: '2026-08-27T10:10:00.000Z',
        gateway: 'paystack',
        metadata: { dva_account_number: '2222222222' },
        status: 'completed',
        transaction_type: 'payment',
      },
    ]);

    expect(accountNumber).toBe('2222222222');
  });

  it('ignores non-Paystack, incomplete, and malformed metadata', () => {
    const accountNumber = getPaystackDvaAccountNumberFromTransactions([
      {
        created_at: '2026-08-27T10:30:00.000Z',
        gateway: 'korapay',
        metadata: { dva_account_number: '3333333333' },
        status: 'completed',
        transaction_type: 'payment',
      },
      {
        created_at: '2026-08-27T10:20:00.000Z',
        gateway: 'paystack',
        metadata: { dva_account_number: 'not-an-account' },
        status: 'completed',
        transaction_type: 'payment',
      },
      {
        created_at: '2026-08-27T10:40:00.000Z',
        gateway: 'paystack',
        metadata: { dva_account_number: '4444444444' },
        status: 'pending',
        transaction_type: 'payment',
      },
    ]);

    expect(accountNumber).toBeNull();
  });

  it('keeps the last metadata receiver when timestamps are unavailable', () => {
    const accountNumber = getPaystackDvaAccountNumberFromTransactions([
      { metadata: { dva_account_number: '5555555555' } },
      { metadata: { dva_account_number: '6666666666' } },
    ]);

    expect(accountNumber).toBe('6666666666');
  });
});
