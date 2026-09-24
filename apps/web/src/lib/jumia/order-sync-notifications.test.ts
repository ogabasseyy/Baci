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
  createDuplicateNotificationSyncMock,
  createQuery,
  createSupabaseMock,
  item,
  order,
} from './order-sync.test-helpers';
import {
  getJumiaNotificationAttemptKey,
  hasSentJumiaOrderNotification,
  markJumiaNotificationSent,
  sendJumiaOrderNotification,
} from './order-sync-notifications';

describe('Jumia order sync notification markers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds a stable notification attempt key', () => {
    expect(getJumiaNotificationAttemptKey('merchant:1', 'order/1')).toBe(
      'merchant%3A1:order%2F1'
    );
  });

  it('detects a previously delivered push from the attempt log', async () => {
    const attemptsQuery = createQuery(
      { data: [{ id: 'attempt-1' }], error: null },
      { terminalIn: true }
    );
    const supabase = createSupabaseMock({
      push_notification_attempts: [attemptsQuery],
    });

    await expect(
      hasSentJumiaOrderNotification(supabase, 'merchant-1', 'jumia-order-1')
    ).resolves.toBe(true);
    expect(attemptsQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(attemptsQuery.eq).toHaveBeenCalledWith(
      'notification_type',
      'new_order'
    );
    expect(attemptsQuery.eq).toHaveBeenCalledWith(
      'payload->>jumia_order_id',
      'jumia-order-1'
    );
    expect(attemptsQuery.in).toHaveBeenCalledWith('status', ['sent']);
  });

  it('fails open when the delivery lookup errors', async () => {
    const errorQuery = createQuery(
      { data: null, error: { message: 'lookup offline' } },
      { terminalIn: true }
    );
    const emptyQuery = createQuery(
      { data: [], error: null },
      { terminalIn: true }
    );

    await expect(
      hasSentJumiaOrderNotification(
        createSupabaseMock({ push_notification_attempts: [errorQuery] }),
        'merchant-1',
        'jumia-order-1'
      )
    ).resolves.toBe(false);
    await expect(
      hasSentJumiaOrderNotification(
        createSupabaseMock({ push_notification_attempts: [emptyQuery] }),
        'merchant-1',
        'jumia-order-1'
      )
    ).resolves.toBe(false);
    // Unknown tables throw inside the mock; the lookup still fails open.
    await expect(
      hasSentJumiaOrderNotification(
        createSupabaseMock({}),
        'merchant-1',
        'jumia-order-1'
      )
    ).resolves.toBe(false);
  });

  it('leaves partially failed push deliveries unmarked for retry', async () => {
    const attemptsQuery = createQuery(
      { data: [], error: null },
      { terminalIn: true }
    );
    const markerQuery = createQuery({
      data: { jumia_order_id: order.id },
      error: null,
    });
    const supabase = createSupabaseMock({
      push_notification_attempts: [attemptsQuery],
      jumia_orders: [markerQuery],
    });
    const notifySyncedJumiaOrder = vi.fn().mockResolvedValue({
      sent: 1,
      failed: 1,
      errors: [],
    });
    const onNotified = vi.fn();
    const existingJumiaOrders = new Map();

    await expect(
      sendJumiaOrderNotification(supabase, {
        merchantId: 'merchant-1',
        integrationId: 'integration-1',
        order,
        canonicalOrderId: 'baci-order-1',
        notificationKey: getJumiaNotificationAttemptKey('merchant-1', order.id),
        attemptedNotificationKeys: new Set<string>(),
        existingJumiaOrders,
        notifySyncedJumiaOrder,
        buildExistingJumiaCacheEntry: vi.fn(),
        onNotified,
      })
    ).rejects.toThrow('Failed to notify merchant for Jumia order');
    expect(markerQuery.update).not.toHaveBeenCalled();
    expect(onNotified).not.toHaveBeenCalled();
    expect(existingJumiaOrders.size).toBe(0);
  });

  it('retries notification_sent updates and scopes them to the merchant', async () => {
    const failedQuery = createQuery({ error: { message: 'write timeout' } });
    const successQuery = createQuery({
      data: { jumia_order_id: 'jumia-order-1' },
      error: null,
    });
    const supabase = createSupabaseMock({
      jumia_orders: [failedQuery, successQuery],
    });

    await expect(
      markJumiaNotificationSent(supabase, 'merchant-1', 'jumia-order-1', {
        retryDelayMs: 0,
      })
    ).resolves.toBe(null);
    expect(failedQuery.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(successQuery.eq).toHaveBeenCalledWith(
      'jumia_order_id',
      'jumia-order-1'
    );
  });

  it('returns the last marker error when all retries fail', async () => {
    const failedQueries = Array.from({ length: 2 }, () =>
      createQuery({ error: { code: '08006', message: 'still failing' } })
    );
    const supabase = createSupabaseMock({ jumia_orders: failedQueries });

    await expect(
      markJumiaNotificationSent(supabase, 'merchant-1', 'jumia-order-1', {
        attempts: 2,
        retryDelayMs: 0,
      })
    ).resolves.toEqual({ code: '08006', message: 'still failing' });
  });

  it('does not retry permanent notification marker errors', async () => {
    const failedQuery = createQuery({
      error: { code: '42501', message: 'permission denied' },
    });
    const supabase = createSupabaseMock({ jumia_orders: [failedQuery] });

    await expect(
      markJumiaNotificationSent(supabase, 'merchant-1', 'jumia-order-1', {
        attempts: 3,
        retryDelayMs: 0,
      })
    ).resolves.toEqual({ code: '42501', message: 'permission denied' });
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('returns an explicit error when no Jumia row is updated', async () => {
    const emptyQuery = createQuery({ data: null, error: null });
    const supabase = createSupabaseMock({ jumia_orders: [emptyQuery] });

    await expect(
      markJumiaNotificationSent(supabase, 'merchant-1', 'jumia-order-1', {
        attempts: 1,
        retryDelayMs: 0,
      })
    ).resolves.toEqual({
      message: 'No Jumia order notification marker updated for jumia-order-1',
    });
  });

  it('skips duplicate Jumia notifications after a marker retry failure in one run', async () => {
    const failedNotificationQueries = Array.from({ length: 3 }, () =>
      createQuery({ error: { message: 'write timeout' } })
    );
    const { duplicateCacheQuery, supabase } =
      createDuplicateNotificationSyncMock({
        jumiaOrder: order,
        markerQueries: failedNotificationQueries,
      });

    mocks.forIntegration.mockResolvedValue({ client: true });
    vi.mocked(getAllOrders).mockResolvedValue([order, order]);
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

    expect(notifyMerchant).toHaveBeenCalledTimes(1);
    for (const query of failedNotificationQueries) {
      expect(query.update).toHaveBeenCalledWith({ notification_sent: true });
    }
    expect(result).toEqual(
      expect.objectContaining({
        synced: 1,
        canonicalCreated: 1,
        canonicalUpdated: 1,
        notified: 1,
        orderErrors: 1,
      })
    );
    expect(duplicateCacheQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_sent: true,
        baci_order_id: 'baci-order-1',
      }),
      { onConflict: 'jumia_order_id' }
    );
    expect(result.errors).toEqual([
      'merchant-1/jumia-order-1: Failed to mark Jumia notification as sent: write timeout',
    ]);
  });

  it('preserves notification state for duplicate Jumia pages after marker success', async () => {
    const notifyUpdateQuery = createQuery({
      data: { jumia_order_id: order.id },
      error: null,
    });
    const { duplicateCacheQuery, supabase } =
      createDuplicateNotificationSyncMock({
        jumiaOrder: order,
        markerQueries: [notifyUpdateQuery],
      });

    mocks.forIntegration.mockResolvedValue({ client: true });
    vi.mocked(getAllOrders).mockResolvedValue([order, order]);
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

    expect(notifyMerchant).toHaveBeenCalledTimes(1);
    expect(duplicateCacheQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_sent: true,
        baci_order_id: 'baci-order-1',
      }),
      { onConflict: 'jumia_order_id' }
    );
    expect(result).toEqual(
      expect.objectContaining({
        synced: 2,
        canonicalCreated: 1,
        canonicalUpdated: 1,
        notified: 1,
        stockUpdated: 0,
        orderErrors: 0,
      })
    );
  });

  it('does not re-notify legacy cache rows already marked as notified', async () => {
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
    const syncCursorQuery = createQuery({ error: null }, { terminalEqCall: 1 });
    const supabase = createSupabaseMock(
      {
        marketplace_integrations: [marketplaceQuery, syncCursorQuery],
        jumia_orders: [existingJumiaQuery, cacheQuery],
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

    const result = await syncJumiaOrdersForActiveIntegrations(supabase);

    expect(notifyMerchant).not.toHaveBeenCalled();
    expect(cacheQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_sent: true,
        baci_order_id: 'baci-order-1',
      }),
      { onConflict: 'jumia_order_id' }
    );
    expect(result).toEqual(
      expect.objectContaining({
        synced: 1,
        canonicalCreated: 1,
        notified: 0,
        stockUpdated: 0,
        orderErrors: 0,
      })
    );
  });
});
