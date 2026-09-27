import { describe, expect, it } from 'vitest';
import { mapTrackingPaymentAccounts } from './map-tracking-payment-accounts';

describe('mapTrackingPaymentAccounts', () => {
  it('maps tracking rows onto the selector input', () => {
    expect(
      mapTrackingPaymentAccounts([
        {
          account_number: '1234567890',
          bank_name: 'Paystack-Titan',
          account_name: 'Baci / Ada',
          provider: 'paystack',
          assignment_customer_email_source: 'order_email',
          created_at: '2026-09-21T10:00:00.000Z',
          assigned_at: '2026-09-21T10:00:01.000Z',
          expires_at: '2026-09-22T10:00:00.000Z',
        },
      ])
    ).toEqual([
      {
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
        account_name: 'Baci / Ada',
        provider: 'paystack',
        assignment_customer_email_source: 'order_email',
        created_at: '2026-09-21T10:00:00.000Z',
        assigned_at: '2026-09-21T10:00:01.000Z',
        expires_at: '2026-09-22T10:00:00.000Z',
      },
    ]);
  });

  it('drops rows without an account number', () => {
    expect(
      mapTrackingPaymentAccounts([
        { account_number: null, bank_name: 'X' },
        'not-an-object',
        null,
        { account_number: '' },
        { account_number: '1234567890', bank_name: null },
      ])
    ).toEqual([
      {
        account_number: '1234567890',
        bank_name: null,
        account_name: null,
        provider: null,
        assignment_customer_email_source: null,
        created_at: null,
        assigned_at: null,
        expires_at: null,
      },
    ]);
  });

  it('returns an empty list for non-array input', () => {
    expect(mapTrackingPaymentAccounts(null)).toEqual([]);
    expect(mapTrackingPaymentAccounts(undefined)).toEqual([]);
    expect(mapTrackingPaymentAccounts({})).toEqual([]);
  });
});
