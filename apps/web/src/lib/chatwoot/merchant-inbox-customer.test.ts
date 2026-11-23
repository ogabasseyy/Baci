import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifier: vi.fn(), currency: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('./chat-customer-link-token', () => ({
  createChatCustomerLinkVerifier: mocks.verifier,
}));
vi.mock('./merchant-currency', () => ({
  loadChatwootMerchantCurrency: mocks.currency,
}));

import { loadCustomerBadges } from './merchant-inbox-customer';
import { A, B, db, MERCHANT } from './merchant-inbox-customer.test-support';

function verifyAs(map: Record<string, string | null>) {
  mocks.verifier.mockResolvedValue(async (token: string) =>
    map[token] ? { merchantId: MERCHANT, customerId: map[token] } : null
  );
}

beforeEach(() => {
  mocks.currency.mockResolvedValue({ currency: 'NGN' });
});

describe('loadCustomerBadges', () => {
  it('adds order count and spend only for links that verify', async () => {
    verifyAs({ good: A, forged: null });
    const { client, seen } = db({
      customers: {
        data: [{ id: A, total_orders: 5, total_spent: 412000 }],
      },
    });

    const badges = await loadCustomerBadges({
      supabase: client,
      merchantId: MERCHANT,
      links: { 1: 'good', 2: 'forged' },
      includeOrderData: true,
    });

    expect(badges).toEqual({ 1: { orderCount: 5, totalSpent: 412000 } });
    // Scoped to this store and to the verified ids only.
    const filters = seen[0].filters;
    expect(filters).toContainEqual(['eq', 'merchant_id', MERCHANT]);
    expect(filters).toContainEqual(['in', 'id', [A]]);
  });

  it('makes no database call when nothing is linked', async () => {
    const { client, seen } = db({});
    await expect(
      loadCustomerBadges({
        supabase: client,
        merchantId: MERCHANT,
        links: {},
        includeOrderData: true,
      })
    ).resolves.toEqual({});
    expect(seen).toHaveLength(0);
  });

  it('makes no database call when no link verifies', async () => {
    verifyAs({ bad: null });
    const { client, seen } = db({});
    await expect(
      loadCustomerBadges({
        supabase: client,
        merchantId: MERCHANT,
        links: { 1: 'bad' },
        includeOrderData: true,
      })
    ).resolves.toEqual({});
    expect(seen).toHaveLength(0);
  });

  it('shares one lookup between chats of the same customer', async () => {
    verifyAs({ t1: A, t2: A, t3: B });
    const { client, seen } = db({
      customers: {
        data: [
          { id: A, total_orders: 2, total_spent: 10 },
          { id: B, total_orders: null, total_spent: null },
        ],
      },
    });
    const badges = await loadCustomerBadges({
      supabase: client,
      merchantId: MERCHANT,
      links: { 1: 't1', 2: 't2', 3: 't3' },
      includeOrderData: true,
    });
    expect(seen).toHaveLength(1);
    expect(badges[1]).toEqual(badges[2]);
    expect(badges[3]).toEqual({ orderCount: 0, totalSpent: 0 });
  });

  it('leaves badges off when signing is not configured or the read fails', async () => {
    mocks.verifier.mockResolvedValue(null);
    const off = db({});
    await expect(
      loadCustomerBadges({
        supabase: off.client,
        merchantId: MERCHANT,
        links: { 1: 'x' },
        includeOrderData: true,
      })
    ).resolves.toEqual({});

    verifyAs({ good: A });
    const broken = db({ customers: { data: null, error: { message: 'x' } } });
    await expect(
      loadCustomerBadges({
        supabase: broken.client,
        merchantId: MERCHANT,
        links: { 1: 'good' },
        includeOrderData: true,
      })
    ).resolves.toEqual({});
  });

  it('bugfix: shows no order count or spend to a caller without order access', async () => {
    verifyAs({ good: A });
    const { client } = db({
      customers: { data: [{ id: A, total_orders: 5, total_spent: 412000 }] },
    });

    const badges = await loadCustomerBadges({
      supabase: client,
      merchantId: MERCHANT,
      links: { 1: 'good' },
      includeOrderData: false,
    });

    // Still a verified signed-in customer, but no order data at all.
    expect(badges).toEqual({
      1: { orderCount: 0, totalSpent: 0, ordersHidden: true },
    });
  });
});
