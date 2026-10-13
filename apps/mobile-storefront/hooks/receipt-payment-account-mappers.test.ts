import { describe, expect, it } from '@jest/globals';
import { mapCustomerPaymentAccountRpcRows } from './receipt-payment-account-mappers';

describe('mapCustomerPaymentAccountRpcRows', () => {
  it('maps the customer-safe account projection into receipt account rows', () => {
    expect(
      mapCustomerPaymentAccountRpcRows([
        {
          account_name: 'Automatic confirmation',
          account_number: '1234567890',
          assigned_at: '2026-08-27T12:00:00.000Z',
          assignment_customer_email_source: 'assignment',
          bank_name: 'Paystack-Titan',
          created_at: '2026-08-27T12:00:00.000Z',
          expires_at: '2026-08-27T13:30:00.000Z',
          provider: 'paystack',
        },
      ])
    ).toEqual([
      {
        account_name: 'Automatic confirmation',
        account_number: '1234567890',
        assigned_at: '2026-08-27T12:00:00.000Z',
        assignment_customer_email_source: 'assignment',
        bank_name: 'Paystack-Titan',
        created_at: '2026-08-27T12:00:00.000Z',
        expires_at: '2026-08-27T13:30:00.000Z',
        provider: 'paystack',
      },
    ]);
  });

  it('returns no accounts for a null RPC result', () => {
    expect(mapCustomerPaymentAccountRpcRows(null)).toEqual([]);
  });
});
