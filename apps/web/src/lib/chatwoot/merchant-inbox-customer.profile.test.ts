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

function verifyAs(map: Record<string, string | null>) {
  mocks.verifier.mockResolvedValue(async (token: string) =>
    map[token] ? { merchantId: MERCHANT, customerId: map[token] } : null
  );
}

beforeEach(() => {
  mocks.currency.mockResolvedValue({ currency: 'NGN' });
});

describe('loadCustomerProfile', () => {
  const customer = {
    id: A,
    full_name: ' Ada Obi ',
    first_name: 'Ada',
    last_name: 'Obi',
    created_at: '2025-01-02T00:00:00Z',
    total_orders: 5,
    total_spent: 412000,
    loyalty_points: 120,
  };

  it('returns name, totals and recent orders, without contact details', async () => {
    verifyAs({ good: A });
    const { client, seen } = db({
      customers: { data: customer },
      orders: {
        data: [
          {
            order_number: 'ORD-1',
            total: 50000,
            currency: null,
            payment_status: 'paid',
            shipping_status: 'shipped',
            created_at: '2026-11-20T10:00:00Z',
          },
        ],
      },
    });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: true,
    });

    expect(profile).toEqual({
      name: 'Ada Obi',
      currency: 'NGN',
      memberSince: '2025-01-02T00:00:00Z',
      orderCount: 5,
      totalSpent: 412000,
      loyaltyPoints: 120,
      recentOrders: [
        {
          orderNumber: 'ORD-1',
          total: 50000,
          currency: 'NGN',
          paymentStatus: 'paid',
          shippingStatus: 'shipped',
          createdAt: '2026-11-20T10:00:00Z',
        },
      ],
    });
    expect(JSON.stringify(profile)).not.toMatch(/email|phone|address/i);
    // Both reads are scoped to this store.
    for (const entry of seen) {
      expect(entry.filters).toContainEqual(['eq', 'merchant_id', MERCHANT]);
    }
  });

  it('returns null for a link that does not verify, without reading', async () => {
    verifyAs({ forged: null });
    const { client, seen } = db({});
    await expect(
      loadCustomerProfile({
        supabase: client,
        merchantId: MERCHANT,
        token: 'forged',
        includeOrders: true,
      })
    ).resolves.toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('returns null when the customer is not in this store', async () => {
    verifyAs({ good: A });
    const { client } = db({ customers: { data: null } });
    await expect(
      loadCustomerProfile({
        supabase: client,
        merchantId: MERCHANT,
        token: 'good',
        includeOrders: true,
      })
    ).resolves.toBeNull();
  });

  it('falls back to a neutral name and still returns with no orders', async () => {
    verifyAs({ good: A });
    const { client } = db({
      customers: {
        data: {
          ...customer,
          full_name: null,
          first_name: null,
          last_name: null,
        },
      },
      orders: { data: null },
    });
    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: true,
    });
    expect(profile).toMatchObject({ name: 'Customer', recentOrders: [] });
  });

  it('bugfix: reads no order details for a caller without order access', async () => {
    verifyAs({ good: A });
    const { client, seen } = db({
      customers: { data: customer },
      orders: {
        data: [
          {
            order_number: 'ORD-1',
            total: 1,
            currency: 'NGN',
            payment_status: 'paid',
            shipping_status: 'shipped',
            created_at: null,
          },
        ],
      },
    });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: false,
    });

    expect(profile?.recentOrders).toEqual([]);
    // Order counts are order data too: hidden along with the order list.
    expect(profile?.orderCount).toBe(0);
    expect(profile?.ordersHidden).toBe(true);
    expect(seen.map((entry) => entry.table)).not.toContain('orders');
  });

  it('bugfix: shows each order in its own currency, the store currency for spend', async () => {
    verifyAs({ good: A });
    mocks.currency.mockResolvedValue({ currency: 'usd' });
    const { client } = db({
      customers: { data: customer },
      orders: {
        data: [
          {
            order_number: 'ORD-9',
            total: 40,
            currency: 'GBP',
            payment_status: 'paid',
            shipping_status: 'shipped',
            created_at: null,
          },
          {
            order_number: 'ORD-8',
            total: 25,
            currency: null,
            payment_status: 'paid',
            shipping_status: 'shipped',
            created_at: null,
          },
        ],
      },
    });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: true,
    });

    expect(profile?.currency).toBe('USD');
    expect(profile?.recentOrders.map((o) => o.currency)).toEqual([
      'GBP',
      'USD',
    ]);
  });

  it('falls back to naira when the store currency cannot be read', async () => {
    verifyAs({ good: A });
    mocks.currency.mockResolvedValue(null);
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
    expect(profile?.currency).toBe('NGN');
  });

  it('bugfix: shows no order count, spend or points without order access, but still the name', async () => {
    verifyAs({ good: A });
    const { client } = db({
      customers: { data: customer },
      orders: { data: [] },
    });

    const profile = await loadCustomerProfile({
      supabase: client,
      merchantId: MERCHANT,
      token: 'good',
      includeOrders: false,
    });

    expect(profile).toMatchObject({
      name: 'Ada Obi',
      loyaltyPoints: 0,
      orderCount: 0,
      totalSpent: 0,
      ordersHidden: true,
      recentOrders: [],
    });
  });

  it('does not flag the profile as hidden for a caller with order access', async () => {
    verifyAs({ good: A });
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
    expect(profile?.ordersHidden).toBeUndefined();
    expect(profile?.orderCount).toBe(5);
  });
});
