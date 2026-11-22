import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifier: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('./chat-customer-link-token', () => ({
  createChatCustomerLinkVerifier: mocks.verifier,
}));

import {
  loadCustomerBadges,
  loadCustomerProfile,
} from './merchant-inbox-customer';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const A = '33333333-3333-4333-8333-33333333333a';
const B = '33333333-3333-4333-8333-33333333333b';

/** Fake query builder: records filters, answers per table. */
function db(answers: Record<string, { data: unknown; error?: unknown }>) {
  const seen: { table: string; filters: unknown[][] }[] = [];
  return {
    seen,
    client: {
      from: (table: string) => {
        const entry = { table, filters: [] as unknown[][] };
        seen.push(entry);
        const result = () =>
          Promise.resolve({ error: null, ...answers[table] });
        const builder: Record<string, unknown> = { maybeSingle: result };
        for (const name of ['select', 'eq', 'in', 'is', 'order', 'limit']) {
          builder[name] = (...args: unknown[]) => {
            entry.filters.push([name, ...args]);
            // The last call of a chain may be awaited directly, so those
            // return a real promise that still offers the rest of the chain.
            return name === 'is' || name === 'limit'
              ? Object.assign(result(), builder)
              : builder;
          };
        }
        return builder;
      },
    } as never,
  };
}

function verifyAs(map: Record<string, string | null>) {
  mocks.verifier.mockResolvedValue(async (token: string) =>
    map[token] ? { merchantId: MERCHANT, customerId: map[token] } : null
  );
}

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
      loadCustomerBadges({ supabase: client, merchantId: MERCHANT, links: {} })
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
      })
    ).resolves.toEqual({});

    verifyAs({ good: A });
    const broken = db({ customers: { data: null, error: { message: 'x' } } });
    await expect(
      loadCustomerBadges({
        supabase: broken.client,
        merchantId: MERCHANT,
        links: { 1: 'good' },
      })
    ).resolves.toEqual({});
  });
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
    });

    expect(profile).toEqual({
      name: 'Ada Obi',
      memberSince: '2025-01-02T00:00:00Z',
      orderCount: 5,
      totalSpent: 412000,
      loyaltyPoints: 120,
      recentOrders: [
        {
          orderNumber: 'ORD-1',
          total: 50000,
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
    });
    expect(profile).toMatchObject({ name: 'Customer', recentOrders: [] });
  });
});
