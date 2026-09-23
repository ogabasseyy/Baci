import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyMerchant } from '@/lib/expo-push';
import { getAllOrders, getOrderItems } from '@/lib/jumia/orders';

const mocks = vi.hoisted(() => ({
  forIntegration: vi.fn(),
}));

vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: mocks.forIntegration,
  },
}));

vi.mock('@/lib/jumia/orders', () => ({
  getAllOrders: vi.fn(),
  getOrderItems: vi.fn(),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyMerchant: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { syncJumiaOrdersForActiveIntegrations } from './order-sync';
import {
  createQuery,
  createSupabaseMock,
  item,
  order,
} from './order-sync.test-helpers';

describe('syncJumiaOrdersForActiveIntegrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty result when there are no active Jumia integrations', async () => {
    const marketplaceQuery = createQuery(
      { data: [], error: null },
      { terminalEqCall: 2 }
    );
    const supabase = createSupabaseMock({
      marketplace_integrations: [marketplaceQuery],
    });

    const result = await syncJumiaOrdersForActiveIntegrations(supabase);

    expect(result).toEqual({
      integrations: 0,
      synced: 0,
      canonicalCreated: 0,
      canonicalUpdated: 0,
      notified: 0,
      stockUpdated: 0,
      orderErrors: 0,
      errors: [],
    });
    expect(mocks.forIntegration).not.toHaveBeenCalled();
  });

  it('notifies when an existing Jumia cache row was never linked to a Baci order', async () => {
    const marketplaceQuery = createQuery(
      {
        data: [
          {
            id: 'integration-1',
            merchant_id: 'merchant-1',
            shop_id: 'shop-1',
            connection_method: 'self_authorization',
            jumia_authorization_id: 'authorization-1',
            last_sync_at: '2026-04-25T07:00:00.000Z',
            sync_config: { orders: true },
          },
        ],
        error: null,
      },
      { terminalEqCall: 2 }
    );
    const existingJumiaQuery = createQuery({
      data: [
        {
          jumia_order_id: order.id,
          notification_sent: false,
          baci_order_id: null,
        },
      ],
      error: null,
    });
    const existingCanonicalQuery = createQuery({ data: [], error: null });
    const insertOrderQuery = createQuery({
      data: {
        id: 'baci-order-1',
        external_id: order.id,
        tracking_token: 'tracking-token',
      },
      error: null,
    });
    const cacheQuery = createQuery({ error: null }, { terminalUpsert: true });
    const notifyUpdateQuery = createQuery({
      data: { jumia_order_id: order.id },
      error: null,
    });
    const syncCursorQuery = createQuery({ error: null }, { terminalEqCall: 1 });
    const supabase = createSupabaseMock(
      {
        marketplace_integrations: [marketplaceQuery, syncCursorQuery],
        jumia_orders: [existingJumiaQuery, cacheQuery, notifyUpdateQuery],
        orders: [existingCanonicalQuery, insertOrderQuery],
      },
      {
        replace_order_items: [{ error: null }],
      }
    );

    mocks.forIntegration.mockResolvedValue({ client: true });
    vi.mocked(getAllOrders).mockResolvedValue([order]);
    vi.mocked(getOrderItems).mockResolvedValue({
      orderId: order.id,
      orderNumber: order.number,
      items: [item],
    });
    vi.mocked(notifyMerchant).mockResolvedValue({
      sent: 1,
      failed: 0,
      errors: [],
    });

    const result = await syncJumiaOrdersForActiveIntegrations(supabase);

    expect(result.notified).toBe(1);
    expect(result.canonicalCreated).toBe(1);
    expect(notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      'Jumia Order',
      expect.stringContaining('Order #12345'),
      expect.objectContaining({
        order_id: 'baci-order-1',
        source: 'jumia',
        jumia_order_id: order.id,
      }),
      'orders'
    );
    expect(notifyUpdateQuery.update).toHaveBeenCalledWith({
      notification_sent: true,
    });
  });

  it('keeps the sync cursor in place when every Jumia order fails', async () => {
    const marketplaceQuery = createQuery(
      {
        data: [
          {
            id: 'integration-1',
            merchant_id: 'merchant-1',
            shop_id: 'shop-1',
            last_sync_at: '2026-04-25T07:00:00.000Z',
            sync_config: { orders: true },
          },
        ],
        error: null,
      },
      { terminalEqCall: 2 }
    );
    const existingJumiaQuery = createQuery({ data: [], error: null });
    const existingCanonicalQuery = createQuery({ data: [], error: null });
    const syncCursorQuery = createQuery({ error: null }, { terminalEqCall: 1 });
    const supabase = createSupabaseMock({
      marketplace_integrations: [marketplaceQuery, syncCursorQuery],
      jumia_orders: [existingJumiaQuery],
      orders: [existingCanonicalQuery],
    });

    mocks.forIntegration.mockResolvedValue({ client: true });
    vi.mocked(getAllOrders).mockResolvedValue([order]);
    vi.mocked(getOrderItems).mockRejectedValue(new Error('item API timeout'));

    const result = await syncJumiaOrdersForActiveIntegrations(supabase);

    expect(result).toEqual({
      integrations: 1,
      synced: 0,
      canonicalCreated: 0,
      canonicalUpdated: 0,
      notified: 0,
      stockUpdated: 0,
      orderErrors: 1,
      errors: ['merchant-1/jumia-order-1: item API timeout'],
    });
    const updatePayload = syncCursorQuery.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updatePayload).toEqual(
      expect.objectContaining({
        sync_error: expect.stringContaining('cursor not advanced'),
      })
    );
    expect(updatePayload).not.toHaveProperty('last_sync_at');
    expect(updatePayload?.sync_config).toEqual(
      expect.objectContaining({
        jumia_full_failure: expect.objectContaining({
          cursor: '2026-04-25T07:00:00.000Z',
          count: 1,
        }),
      })
    );
  });

  it('parks the sync cursor at the earliest failed Jumia order', async () => {
    const secondOrder = {
      ...order,
      id: 'jumia-order-2',
      number: '23456',
      updatedAt: '2026-04-25T08:03:00.000Z',
    };
    const marketplaceQuery = createQuery(
      {
        data: [
          {
            id: 'integration-1',
            merchant_id: 'merchant-1',
            shop_id: 'shop-1',
            last_sync_at: '2026-04-25T07:00:00.000Z',
            sync_config: { orders: true },
          },
        ],
        error: null,
      },
      { terminalEqCall: 2 }
    );
    const existingJumiaQuery = createQuery({
      data: [
        {
          jumia_order_id: order.id,
          notification_sent: true,
          baci_order_id: 'baci-order-1',
        },
        {
          jumia_order_id: secondOrder.id,
          notification_sent: true,
          baci_order_id: null,
        },
      ],
      error: null,
    });
    const existingCanonicalQuery = createQuery({
      data: [
        {
          id: 'baci-order-1',
          external_id: order.id,
          tracking_token: 'tracking-token',
        },
      ],
      error: null,
    });
    const updateOrderQuery = createQuery({
      data: {
        id: 'baci-order-1',
        external_id: order.id,
        tracking_token: 'tracking-token',
      },
      error: null,
    });
    const cacheQuery = createQuery({ error: null }, { terminalUpsert: true });
    const syncCursorQuery = createQuery({ error: null }, { terminalEqCall: 1 });
    const supabase = createSupabaseMock(
      {
        marketplace_integrations: [marketplaceQuery, syncCursorQuery],
        jumia_orders: [existingJumiaQuery, cacheQuery],
        orders: [existingCanonicalQuery, updateOrderQuery],
      },
      {
        replace_order_items_suppressing_order_notifications: [{ error: null }],
      }
    );

    mocks.forIntegration.mockResolvedValue({ client: true });
    vi.mocked(getAllOrders).mockResolvedValue([order, secondOrder]);
    vi.mocked(getOrderItems)
      .mockResolvedValueOnce({
        orderId: order.id,
        orderNumber: order.number,
        items: [item],
      })
      .mockRejectedValueOnce(new Error('item API timeout'));

    const result = await syncJumiaOrdersForActiveIntegrations(supabase);

    expect(result.synced).toBe(1);
    expect(result.canonicalUpdated).toBe(1);
    expect(result.orderErrors).toBe(1);
    expect(result.errors).toEqual([
      'merchant-1/jumia-order-2: item API timeout',
    ]);
    const updatePayload = syncCursorQuery.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updatePayload).toEqual(
      expect.objectContaining({
        last_sync_at: '2026-04-25T08:03:00.000Z',
        sync_error: expect.stringContaining(
          'cursor parked at earliest failed order'
        ),
      })
    );
  });

  it('treats failed Jumia push notifications as sync errors', async () => {
    const marketplaceQuery = createQuery(
      {
        data: [
          {
            id: 'integration-1',
            merchant_id: 'merchant-1',
            shop_id: 'shop-1',
            last_sync_at: '2026-04-25T07:00:00.000Z',
            sync_config: { orders: true },
          },
        ],
        error: null,
      },
      { terminalEqCall: 2 }
    );
    const existingJumiaQuery = createQuery({
      data: [
        {
          jumia_order_id: order.id,
          notification_sent: false,
          baci_order_id: null,
        },
      ],
      error: null,
    });
    const existingCanonicalQuery = createQuery({ data: [], error: null });
    const insertOrderQuery = createQuery({
      data: {
        id: 'baci-order-1',
        external_id: order.id,
        tracking_token: 'tracking-token',
      },
      error: null,
    });
    const cacheQuery = createQuery({ error: null }, { terminalUpsert: true });
    const notifyUpdateQuery = createQuery({
      data: { jumia_order_id: order.id },
      error: null,
    });
    const syncCursorQuery = createQuery({ error: null }, { terminalEqCall: 1 });
    const supabase = createSupabaseMock(
      {
        marketplace_integrations: [marketplaceQuery, syncCursorQuery],
        jumia_orders: [existingJumiaQuery, cacheQuery, notifyUpdateQuery],
        orders: [existingCanonicalQuery, insertOrderQuery],
      },
      {
        replace_order_items: [{ error: null }],
      }
    );

    mocks.forIntegration.mockResolvedValue({ client: true });
    vi.mocked(getAllOrders).mockResolvedValue([order]);
    vi.mocked(getOrderItems).mockResolvedValue({
      orderId: order.id,
      orderNumber: order.number,
      items: [item],
    });
    vi.mocked(notifyMerchant).mockResolvedValue({
      sent: 1,
      failed: 1,
      errors: ['Expo outage'],
    });

    const result = await syncJumiaOrdersForActiveIntegrations(supabase);

    expect(result.synced).toBe(0);
    expect(result.canonicalCreated).toBe(1);
    expect(result.notified).toBe(1);
    expect(result.orderErrors).toBe(1);
    expect(notifyUpdateQuery.update).toHaveBeenCalledWith({
      notification_sent: true,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Failed to notify merchant for Jumia order: Expo outage'
        ),
      ])
    );
    const updatePayload = syncCursorQuery.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updatePayload).toEqual(
      expect.objectContaining({
        sync_error: expect.stringContaining('cursor not advanced'),
      })
    );
    expect(updatePayload).not.toHaveProperty('last_sync_at');
  });

  it('records stock-scope lookup failures instead of silently skipping', async () => {
    const marketplaceQuery = createQuery(
      {
        data: [
          {
            id: 'integration-1',
            merchant_id: 'merchant-1',
            shop_id: 'shop-1',
            connection_method: 'self_authorization',
            jumia_authorization_id: 'authorization-1',
            last_sync_at: null,
            sync_config: { orders: false, stock: true },
          },
        ],
        error: null,
      },
      { terminalEqCall: 2 }
    );
    const scopeQuery = createQuery(
      { data: null, error: { message: 'db down' } },
      { terminalEqCall: 4 }
    );
    const supabase = createSupabaseMock({
      marketplace_integrations: [marketplaceQuery, scopeQuery],
    });

    const result = await syncJumiaOrdersForActiveIntegrations(supabase);

    expect(result.stockUpdated).toBe(0);
    expect(result.errors).toEqual([
      'Failed to resolve Jumia stock scope for merchant-1: db down',
    ]);
    expect(mocks.forIntegration).not.toHaveBeenCalled();
  });
});
