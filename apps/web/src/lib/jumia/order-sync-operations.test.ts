import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSendResult } from '@/lib/expo-push';

const mocks = vi.hoisted(() => ({
  notifyMerchant: vi.fn(),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyMerchant: mocks.notifyMerchant,
}));

import {
  createQuery,
  createSupabaseMock,
  item,
  order,
} from './order-sync.test-helpers';
import {
  buildSyncedJumiaCacheRow,
  chunkOrderIds,
  formatJumiaOrderAmount,
  loadExistingCanonicalOrders,
  loadExistingJumiaOrders,
  notifySyncedJumiaOrder,
  upsertCanonicalOrder,
} from './order-sync-operations';

const integration = {
  id: 'integration-1',
  merchant_id: 'merchant-1',
  shop_id: 'shop-1',
  last_sync_at: '2026-04-25T07:00:00.000Z',
  sync_config: { orders: true },
};

describe('Jumia order sync operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('chunks order ids into bounded batches', () => {
    const orderIds = Array.from(
      { length: 201 },
      (_, index) => `order-${index}`
    );

    expect(chunkOrderIds(orderIds)).toEqual([
      orderIds.slice(0, 100),
      orderIds.slice(100, 200),
      ['order-200'],
    ]);
  });

  it('returns no chunks for an empty order id list', () => {
    expect(chunkOrderIds([])).toEqual([]);
  });

  it('keeps exactly 100 order ids in a single chunk', () => {
    const orderIds = Array.from(
      { length: 100 },
      (_, index) => `order-${index}`
    );

    expect(chunkOrderIds(orderIds)).toEqual([orderIds]);
  });

  it('keeps a single order id in one chunk', () => {
    expect(chunkOrderIds(['order-0'])).toEqual([['order-0']]);
  });

  it('loads existing Jumia cache rows in bounded chunks', async () => {
    const orderIds = Array.from(
      { length: 101 },
      (_, index) => `order-${index}`
    );
    const firstQuery = createQuery({
      data: [
        {
          jumia_order_id: 'order-0',
          notification_sent: false,
          baci_order_id: null,
        },
      ],
      error: null,
    });
    const secondQuery = createQuery({
      data: [
        {
          jumia_order_id: 'order-100',
          notification_sent: true,
          baci_order_id: 'baci-100',
        },
      ],
      error: null,
    });
    const supabase = createSupabaseMock({
      jumia_orders: [firstQuery, secondQuery],
    });

    const rows = await loadExistingJumiaOrders(
      supabase,
      'merchant-1',
      orderIds
    );

    expect(rows.get('order-0')?.notification_sent).toBe(false);
    expect(rows.get('order-100')?.baci_order_id).toBe('baci-100');
    expect(firstQuery.in).toHaveBeenCalledWith(
      'jumia_order_id',
      orderIds.slice(0, 100)
    );
    expect(secondQuery.in).toHaveBeenCalledWith('jumia_order_id', [
      'order-100',
    ]);
  });

  it('surfaces Jumia cache lookup failures', async () => {
    const failingQuery = createQuery({
      data: null,
      error: { message: 'database error' },
    });
    const supabase = createSupabaseMock({ jumia_orders: [failingQuery] });

    await expect(
      loadExistingJumiaOrders(supabase, 'merchant-1', ['order-1'])
    ).rejects.toThrow('Failed to load Jumia orders: database error');
  });

  it('excludes canonical order rows with null external_id from results', async () => {
    const query = createQuery({
      data: [
        {
          id: 'baci-order-1',
          external_id: 'jumia-order-1',
          tracking_token: 'token-1',
        },
        {
          id: 'baci-order-2',
          external_id: null,
          tracking_token: 'token-2',
        },
      ],
      error: null,
    });
    const supabase = createSupabaseMock({ orders: [query] });

    const rows = await loadExistingCanonicalOrders(supabase, 'merchant-1', [
      'jumia-order-1',
    ]);

    expect(rows.size).toBe(1);
    expect(rows.get('jumia-order-1')?.id).toBe('baci-order-1');
  });

  it('surfaces canonical order lookup failures', async () => {
    const failingQuery = createQuery({
      data: null,
      error: { message: 'orders unavailable' },
    });
    const supabase = createSupabaseMock({ orders: [failingQuery] });

    await expect(
      loadExistingCanonicalOrders(supabase, 'merchant-1', ['jumia-order-1'])
    ).rejects.toThrow('Failed to load Baci orders: orders unavailable');
  });

  it('deletes a newly inserted order when replacing order items fails', async () => {
    const insertOrderQuery = createQuery({
      data: {
        id: 'created-order-1',
        external_id: order.id,
        tracking_token: 'token-1',
      },
      error: null,
    });
    const cleanupOrderQuery = createQuery(
      { error: null },
      { terminalEqCall: 2 }
    );
    const supabase = createSupabaseMock(
      { orders: [insertOrderQuery, cleanupOrderQuery] },
      { replace_order_items: [{ error: { message: 'rpc down' } }] }
    );

    await expect(
      upsertCanonicalOrder(supabase, integration, order, [item], undefined)
    ).rejects.toThrow('Failed to replace Jumia order items: rpc down');
    expect(cleanupOrderQuery.delete).toHaveBeenCalled();
    expect(cleanupOrderQuery.eq).toHaveBeenCalledWith('id', 'created-order-1');
    expect(cleanupOrderQuery.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
  });

  it('inserts a canonical order and replaces its items', async () => {
    const insertOrderQuery = createQuery({
      data: {
        id: 'created-order-1',
        external_id: order.id,
        tracking_token: 'token-1',
      },
      error: null,
    });
    const supabase = createSupabaseMock(
      { orders: [insertOrderQuery] },
      { replace_order_items: [{ error: null }] }
    );

    const result = await upsertCanonicalOrder(
      supabase,
      integration,
      order,
      [item],
      undefined
    );

    expect(result).toMatchObject({
      id: 'created-order-1',
      external_id: order.id,
      tracking_token: 'token-1',
    });
    expect(insertOrderQuery.insert).toHaveBeenCalled();
  });

  it('updates an existing order atomically through the item replacement RPC', async () => {
    const supabase = createSupabaseMock(
      {},
      { replace_order_items_suppressing_order_notifications: [{ error: null }] }
    );
    const existingOrder = {
      id: 'existing-order-1',
      external_id: order.id,
      tracking_token: 'token-before-update',
    };

    const result = await upsertCanonicalOrder(
      supabase,
      integration,
      order,
      [item],
      existingOrder
    );

    expect(result).toEqual(existingOrder);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'replace_order_items_suppressing_order_notifications',
      {
        p_order_id: 'existing-order-1',
        p_items: expect.arrayContaining([
          expect.objectContaining({ order_id: 'existing-order-1' }),
        ]),
        p_merchant_id: 'merchant-1',
        p_order_patch: expect.objectContaining({
          external_id: order.id,
          tracking_token: 'token-before-update',
        }),
      }
    );
  });

  it('builds a synced Jumia cache row for the persisted Baci order', () => {
    const row = buildSyncedJumiaCacheRow(
      integration,
      order,
      [item],
      {
        jumia_order_id: order.id,
        notification_sent: true,
        baci_order_id: 'old-order',
      },
      'baci-order-1'
    );

    expect(row).toMatchObject({
      merchant_id: 'merchant-1',
      jumia_order_id: order.id,
      baci_order_id: 'baci-order-1',
      notification_sent: true,
      items: [
        expect.objectContaining({
          id: item.id,
          product: expect.objectContaining({ sellerSku: 'SKU-1' }),
        }),
      ],
    });
  });

  it('formats Jumia order amounts with NGN locale formatting', () => {
    expect(formatJumiaOrderAmount(order)).toBe('₦250,000.00');
  });

  it('formats Jumia order amounts with a plain fallback for invalid currency', () => {
    expect(
      formatJumiaOrderAmount({
        ...order,
        totalAmount: { currency: 'INVALID', value: 250000 },
      })
    ).toBe('INVALID 250,000');
  });

  it('formats missing Jumia order amounts as zero NGN', () => {
    expect(
      formatJumiaOrderAmount({
        ...order,
        totalAmount: undefined,
      } as unknown as typeof order)
    ).toBe('₦0.00');
  });

  it('returns the notification result when delivery has no sent count', async () => {
    mocks.notifyMerchant.mockResolvedValue(undefined);

    await expect(
      notifySyncedJumiaOrder('merchant-1', order, 'baci-order-1')
    ).resolves.toEqual({ sent: 0, failed: 0, errors: [] });
  });

  it('returns the notification result when delivery sends a push', async () => {
    const notificationResult: NotificationSendResult = {
      sent: 1,
      failed: 0,
      errors: [],
    };
    mocks.notifyMerchant.mockResolvedValue(notificationResult);

    await expect(
      notifySyncedJumiaOrder('merchant-1', order, 'baci-order-1')
    ).resolves.toEqual(notificationResult);
  });

  it('forwards token exclusions for partial-delivery retries', async () => {
    mocks.notifyMerchant.mockResolvedValue({
      sent: 1,
      failed: 0,
      errors: [],
    });

    await notifySyncedJumiaOrder('merchant-1', order, 'baci-order-1', {
      excludeTokens: ['token-a'],
    });

    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ jumia_order_id: order.id }),
      'orders',
      { excludeTokens: ['token-a'] }
    );
  });

  it('propagates notification delivery errors', async () => {
    mocks.notifyMerchant.mockRejectedValue(new Error('Push service down'));

    await expect(
      notifySyncedJumiaOrder('merchant-1', order, 'baci-order-1')
    ).rejects.toThrow('Push service down');
  });
});
