import { describe, expect, it } from '@jest/globals';
import { mapCustomerTransactionRpcRows } from './receipt-transaction-mappers';

describe('mapCustomerTransactionRpcRows', () => {
  it('maps the customer-safe DVA projection into receipt transaction metadata', () => {
    expect(
      mapCustomerTransactionRpcRows([
        {
          amount: 1000,
          created_at: '2026-08-27T12:00:00.000Z',
          description: 'Paystack transfer',
          dva_account_number: '1234567890',
          gateway: 'paystack',
          status: 'completed',
          transaction_type: 'payment',
        },
      ])
    ).toEqual([
      {
        amount: 1000,
        created_at: '2026-08-27T12:00:00.000Z',
        description: 'Paystack transfer',
        gateway: 'paystack',
        metadata: { dva_account_number: '1234567890' },
        status: 'completed',
        transaction_type: 'payment',
      },
    ]);
  });

  it('returns no transactions for a null RPC result', () => {
    expect(mapCustomerTransactionRpcRows(null)).toEqual([]);
  });
});
