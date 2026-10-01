import { describe, expect, it } from 'vitest';
import { toOrderPaymentAccount } from './storefront-customer-payment-account-adapter';

describe('toOrderPaymentAccount', () => {
  it('removes the customer lookup order id before a response is assembled', () => {
    expect(
      toOrderPaymentAccount({
        account_name: 'Automatic confirmation',
        account_number: '1234567890',
        assigned_at: '2026-08-27T12:00:00.000Z',
        assignment_customer_email_source: 'assignment',
        bank_name: 'Paystack-Titan',
        created_at: '2026-08-27T12:00:00.000Z',
        expires_at: '2026-08-27T13:30:00.000Z',
        order_id: 'order-1',
        provider: 'paystack',
      })
    ).toEqual({
      account_name: 'Automatic confirmation',
      account_number: '1234567890',
      assigned_at: '2026-08-27T12:00:00.000Z',
      assignment_customer_email_source: 'assignment',
      bank_name: 'Paystack-Titan',
      created_at: '2026-08-27T12:00:00.000Z',
      expires_at: '2026-08-27T13:30:00.000Z',
      provider: 'paystack',
    });
  });
});
