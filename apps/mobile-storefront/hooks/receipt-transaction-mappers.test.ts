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

  it('coerces PostgREST decimal amounts strictly for the detail gate', () => {
    const mapped = mapCustomerTransactionRpcRows([
      { amount: '1000.50', created_at: '2026-08-27T12:00:00.000Z' },
      { amount: '', created_at: '2026-08-27T12:00:00.000Z' },
      { amount: true, created_at: '2026-08-27T12:00:00.000Z' },
    ]);

    expect(mapped[0]?.amount).toBe(1000.5);
    // Blank/bool must fail the detail closed, never mask to 0/1.
    expect(mapped[1]?.amount).toBeNaN();
    expect(mapped[2]?.amount).toBeNaN();
  });

  it('carries the recorded payment method into metadata like the email', () => {
    expect(
      mapCustomerTransactionRpcRows([
        {
          amount: 1000,
          created_at: '2026-08-27T12:00:00.000Z',
          description: 'Manual payment note',
          dva_account_number: null,
          gateway: null,
          payment_method: 'bank_transfer',
          status: 'completed',
          transaction_type: 'payment',
        },
      ])
    ).toEqual([
      expect.objectContaining({
        metadata: { payment_method: 'bank_transfer' },
      }),
    ]);
  });

  it('preserves null timestamps for the detail date fallback', () => {
    // transactions.created_at is nullable: the mapper keeps the null and
    // dating skips it like the emailed renderer, instead of dropping the row.
    const mapped = mapCustomerTransactionRpcRows([
      { amount: 100, created_at: null },
    ]);

    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.created_at).toBeNull();
  });

  it('keeps DVA metadata alongside the recorded method', () => {
    expect(
      mapCustomerTransactionRpcRows([
        {
          amount: 1000,
          created_at: '2026-08-27T12:00:00.000Z',
          description: 'Paystack transfer',
          dva_account_number: '1234567890',
          gateway: 'paystack',
          payment_method: 'bank_transfer',
          status: 'completed',
          transaction_type: 'payment',
        },
      ])
    ).toEqual([
      expect.objectContaining({
        metadata: {
          dva_account_number: '1234567890',
          payment_method: 'bank_transfer',
        },
      }),
    ]);
  });

  it('maps corrupt payloads and rows to nothing instead of throwing', () => {
    expect(mapCustomerTransactionRpcRows(null)).toEqual([]);
    expect(mapCustomerTransactionRpcRows({})).toEqual([]);
    expect(mapCustomerTransactionRpcRows([null, 7, []])).toEqual([]);
  });
});
