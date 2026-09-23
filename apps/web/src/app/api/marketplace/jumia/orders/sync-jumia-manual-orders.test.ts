import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAllOrders: vi.fn(),
  getOrderItems: vi.fn(),
  notifyJumiaOrder: vi.fn(),
}));

vi.mock('@/lib/jumia/orders', () => ({
  getAllOrders: mocks.getAllOrders,
  getOrderItems: mocks.getOrderItems,
}));

vi.mock('@/lib/expo-push', () => ({
  notifyJumiaOrder: mocks.notifyJumiaOrder,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { syncJumiaManualOrders } from './sync-jumia-manual-orders';

const jumiaClient = {
  shopId: 'shop-1',
  countryCode: 'NG',
  marketplaceKey: 'Jumia Nigeria',
};

function scopeQuery(rows: Array<{ marketplace_key: string | null }>) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((column: string) =>
      column === 'shop_id'
        ? Promise.resolve({ data: rows, error: null })
        : query
    ),
    update: vi.fn().mockReturnThis(),
  };
  return query;
}

function supabaseMock(options: {
  scopeRows: Array<{ marketplace_key: string | null }>;
  upserted: Array<Record<string, unknown>>;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'marketplace_integrations') {
        const query = scopeQuery(options.scopeRows);
        query.update = vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: null })),
          })),
        }));
        return query;
      }
      if (table === 'jumia_orders') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          upsert: vi.fn((payload: Record<string, unknown>) => {
            options.upserted.push(payload);
            return Promise.resolve({ error: null });
          }),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: null })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

const providerOrder = {
  id: 'order-1',
  number: '1001',
  status: 'pending',
  totalAmount: { value: 5000, currency: 'NGN' },
  createdAt: '2026-09-20T10:00:00Z',
  shippingAddress: { firstName: 'Ada', lastName: 'Lovelace', phone: '0801' },
};

describe('syncJumiaManualOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllOrders.mockResolvedValue([providerOrder]);
    mocks.getOrderItems.mockResolvedValue({ items: [] });
    mocks.notifyJumiaOrder.mockResolvedValue(undefined);
  });

  it('stamps the selected key when the shop scope is unambiguous', async () => {
    const upserted: Array<Record<string, unknown>> = [];
    const supabase = supabaseMock({
      scopeRows: [{ marketplace_key: 'Jumia Nigeria' }],
      upserted,
    });

    const result = await syncJumiaManualOrders({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
      jumiaClient: jumiaClient as never,
    });

    expect(result).toEqual({ synced: 1, newOrders: 1 });
    expect(upserted).toHaveLength(1);
    expect(upserted[0]?.marketplace_key).toBe('Jumia Nigeria');
  });

  it('keeps the neutral key when the shop scope is ambiguous', async () => {
    const upserted: Array<Record<string, unknown>> = [];
    const supabase = supabaseMock({
      scopeRows: [
        { marketplace_key: 'Jumia Nigeria' },
        { marketplace_key: 'Jumia Ghana' },
      ],
      upserted,
    });

    const result = await syncJumiaManualOrders({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
      jumiaClient: jumiaClient as never,
    });

    expect(result).toEqual({ synced: 1, newOrders: 1 });
    expect(upserted).toHaveLength(1);
    expect(upserted[0]?.marketplace_key).toBe('default');
  });

  it('returns zeros when the provider has no orders', async () => {
    mocks.getAllOrders.mockResolvedValue([]);
    const upserted: Array<Record<string, unknown>> = [];
    const supabase = supabaseMock({
      scopeRows: [{ marketplace_key: 'Jumia Nigeria' }],
      upserted,
    });

    const result = await syncJumiaManualOrders({
      supabase: supabase as never,
      merchantId: 'merchant-1',
      integrationId: 'integration-1',
      jumiaClient: jumiaClient as never,
    });

    expect(result).toEqual({ synced: 0, newOrders: 0 });
    expect(upserted).toHaveLength(0);
  });
});
