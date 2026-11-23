import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifier: vi.fn(), currency: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('./chat-customer-link-token', () => ({
  createChatCustomerLinkVerifier: mocks.verifier,
}));
vi.mock('./merchant-currency', () => ({
  loadChatwootMerchantCurrency: mocks.currency,
}));

import { loadCustomerProfile } from './merchant-inbox-customer';
import { A, db, MERCHANT } from './merchant-inbox-customer.test-support';

const customer = {
  id: A,
  full_name: 'Ada Obi',
  first_name: 'Ada',
  last_name: 'Obi',
  created_at: '2025-01-02T00:00:00Z',
  total_orders: 5,
  total_spent: 412000,
  loyalty_points: 120,
};

const order = (orderNumber: string | null) => ({
  order_number: orderNumber,
  total: 50000,
  currency: 'NGN',
  payment_status: 'paid',
  shipping_status: 'shipped',
  created_at: '2026-11-20T10:00:00Z',
});

beforeEach(() => {
  mocks.currency.mockResolvedValue({ currency: 'NGN' });
  mocks.verifier.mockResolvedValue(async () => ({
    merchantId: MERCHANT,
    customerId: A,
  }));
});

describe('bugfix: the customer card shows only what the caller may see', () => {
  it('does not tell a caller without order access how old the account is', async () => {
    const { client } = db({ customers: { data: customer } });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: false,
    });

    expect(profile).toMatchObject({
      name: 'Ada Obi',
      memberSince: null,
      ordersHidden: true,
    });
  });

  it('keeps the account age for a caller with order access', async () => {
    const { client } = db({
      customers: { data: customer },
      orders: { data: [] },
    });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: true,
    });

    expect(profile?.memberSince).toBe('2025-01-02T00:00:00Z');
  });

  it('leaves out an order that has no number instead of showing "null"', async () => {
    const { client } = db({
      customers: { data: customer },
      orders: { data: [order(null), order('  '), order('ORD-7')] },
    });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: true,
    });

    expect(profile?.recentOrders.map((o) => o.orderNumber)).toEqual(['ORD-7']);
  });
});
