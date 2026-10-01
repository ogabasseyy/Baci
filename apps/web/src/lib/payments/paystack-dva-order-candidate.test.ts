import { describe, expect, it } from 'vitest';
import {
  getPaystackCustomerName,
  getPaystackDvaOrderCurrency,
  normalizePaystackDvaOrderCandidate,
  toPaystackKobo,
} from '@/lib/payments/paystack-dva-order-candidate';

const row = {
  assigned_at: '2026-05-09T10:00:00Z',
  created_at: '2026-05-09T10:00:00Z',
  expires_at: '2026-05-09T11:30:00Z',
  order_id: 'order-1',
  payable_amount: '350000',
  orders: {
    amount_paid: '0',
    currency: 'NGN',
    customer_email: 'customer@example.com',
    merchant_id: 'merchant-1',
    payment_status: 'unpaid',
    recorded_by_user_id: null,
    shipping_status: 'pending',
    total: '835000',
    updated_at: '2026-05-09T09:55:00Z',
  },
};

describe('paystack DVA order candidate', () => {
  it('normalizes an active unpaid invoice using its payable amount', () => {
    expect(normalizePaystackDvaOrderCandidate(row)).toMatchObject({
      customer_email: 'customer@example.com',
      merchant_id: 'merchant-1',
      merchant_created: false,
      order_id: 'order-1',
      outstanding_amount_kobo: 35_000_000,
      payable_amount_kobo: 35_000_000,
      total_kobo: 83_500_000,
    });
  });

  it('rejects terminal payment and shipping states', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: { ...row.orders, payment_status: 'paid' },
      })
    ).toBeNull();
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: { ...row.orders, shipping_status: 'canceled' },
      })
    ).toBeNull();
  });

  it('prefers the refreshed payable balance over a stale amount_paid value', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: {
          ...row.orders,
          amount_paid: '300000',
          payment_status: 'partially_paid',
          recorded_by_user_id: 'merchant-user-1',
        },
      })
    ).toMatchObject({
      merchant_created: true,
      outstanding_amount_kobo: 35_000_000,
    });
  });

  it('caps a stale storefront snapshot at the current remaining balance', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        payable_amount: '835000',
        orders: {
          ...row.orders,
          amount_paid: '300000',
          payment_status: 'partially_paid',
          recorded_by_user_id: null,
        },
      })
    ).toMatchObject({
      merchant_created: false,
      outstanding_amount_kobo: 53_500_000,
      payable_amount_kobo: 83_500_000,
    });
  });

  it('preserves the assignment-time balance for a delayed historical transfer', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: {
          ...row.orders,
          amount_paid: '600000',
          payment_status: 'partially_paid',
          recorded_by_user_id: 'merchant-user-1',
        },
      })
    ).toMatchObject({
      outstanding_amount_kobo: 35_000_000,
    });
  });

  it('uses the assignment-time email after the order email changes', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        assignment_customer_email: 'old@example.com',
        orders: { ...row.orders, customer_email: 'new@example.com' },
      })
    ).toMatchObject({ customer_email: 'old@example.com' });
  });

  it('rejects legacy-untrusted aliases instead of falling back to the current order email', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        assignment_customer_email: null,
        assignment_customer_email_source: 'legacy_untrusted',
        orders: { ...row.orders, customer_email: 'new@example.com' },
      })
    ).toBeNull();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects a non-finite amount paid value of %s', (amountPaid) => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: { ...row.orders, amount_paid: amountPaid },
      })
    ).toBeNull();
  });

  it('preserves the assigned payable residual for a merchant-created invoice without recorded payments', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: {
          ...row.orders,
          recorded_by_user_id: 'merchant-user-1',
        },
      })
    ).toMatchObject({
      merchant_created: true,
      outstanding_amount_kobo: 35_000_000,
    });
  });

  it('preserves the assigned payable residual after DVA setup updates the order timestamp', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: {
          ...row.orders,
          recorded_by_user_id: 'merchant-user-1',
          updated_at: '2026-05-09T10:05:00Z',
        },
      })
    ).toMatchObject({
      merchant_created: true,
      outstanding_amount_kobo: 35_000_000,
    });
  });

  it('marks customer-created orders as ineligible for automatic partial allocation', () => {
    expect(
      normalizePaystackDvaOrderCandidate({
        ...row,
        orders: { ...row.orders, recorded_by_user_id: null },
      })
    ).toMatchObject({ merchant_created: false });
  });

  it('returns the winner currency and converts NGN to kobo', () => {
    expect(getPaystackDvaOrderCurrency([row], 'order-1')).toBe('NGN');
    expect(toPaystackKobo(835_000)).toBe(83_500_000);
    expect(
      getPaystackCustomerName({ first_name: ' Tony ', last_name: 'Clarke' })
    ).toBe('Tony Clarke');
  });
});
