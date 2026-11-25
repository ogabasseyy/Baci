import { describe, expect, it } from 'vitest';
import {
  getAdminNotificationNavigationTarget,
  getStorefrontNotificationNavigationTarget,
} from './push-notification-payloads';

describe('repair notification navigation', () => {
  it('routes storefront repair payloads to repairs with the repair id', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'repair',
        repair_id: 'repair-123',
      })
    ).toEqual({ screen: 'repairs', params: { id: 'repair-123' } });
  });

  it('routes storefront repair payloads without ids to repairs', () => {
    expect(
      getStorefrontNotificationNavigationTarget({ type: 'repair' })
    ).toEqual({ screen: 'repairs' });
  });

  it('routes admin repair payloads using camelCase or snake_case ids', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'repair',
        repairId: 'repair-42',
      })
    ).toEqual({ screen: 'repair', params: { id: 'repair-42' } });
    expect(
      getAdminNotificationNavigationTarget({
        type: 'repair',
        repair_id: 'repair-99',
      })
    ).toEqual({ screen: 'repair', params: { id: 'repair-99' } });
  });

  it('falls back to the repairs list when a repair payload lacks an id', () => {
    expect(getAdminNotificationNavigationTarget({ type: 'repair' })).toEqual({
      screen: 'repairs',
    });
  });
});

describe('admin notification navigation edge cases', () => {
  it.each([
    'paystack_refund_processed',
    'paystack_refund_needs_attention',
  ])('opens the affected order for %s', (type) => {
    expect(
      getAdminNotificationNavigationTarget({ type, order_id: 'order-1' })
    ).toEqual({ screen: 'order', params: { id: 'order-1' } });
  });
  it('returns null for null or undefined payload', () => {
    expect(getAdminNotificationNavigationTarget(null)).toBeNull();
    expect(getAdminNotificationNavigationTarget(undefined)).toBeNull();
  });

  it('returns index for an unknown notification type', () => {
    expect(
      getAdminNotificationNavigationTarget({ type: 'unknown_type' })
    ).toEqual({ screen: 'index' });
  });

  it('routes low_stock with product_id to product screen', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'low_stock',
        product_id: 'prod-1',
      })
    ).toEqual({ screen: 'product', params: { id: 'prod-1' } });
  });

  it('routes low_stock without product_id to products list', () => {
    expect(getAdminNotificationNavigationTarget({ type: 'low_stock' })).toEqual(
      { screen: 'products' }
    );
  });

  it('routes admin_broadcast to notifications', () => {
    expect(
      getAdminNotificationNavigationTarget({ type: 'admin_broadcast' })
    ).toEqual({ screen: 'notifications' });
  });

  it('routes jumia_order to orders', () => {
    expect(
      getAdminNotificationNavigationTarget({ type: 'jumia_order' })
    ).toEqual({ screen: 'orders' });
  });

  it('opens the order for a single unconfirmed BNPL payment alert', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'stuck_bnpl_alert',
        order_id: 'order-7',
      })
    ).toEqual({ screen: 'order', params: { id: 'order-7' } });
  });

  it('opens the orders list when the BNPL alert covers several orders', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'stuck_bnpl_alert',
        stuck_order_count: 3,
      })
    ).toEqual({ screen: 'orders' });
  });
});

describe('customer message notification navigation', () => {
  it('routes a numeric conversation id to that conversation', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'customer_message',
        conversation_id: 4821,
      })
    ).toEqual({ screen: 'message', params: { id: '4821' } });
  });

  it('ignores extra keys such as the follow-up and handover markers', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'customer_message',
        conversation_id: 4821,
        follow_up: true,
        handover: true,
      })
    ).toEqual({ screen: 'message', params: { id: '4821' } });
  });

  it('accepts a numeric string id', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'customer_message',
        conversationId: '77',
      })
    ).toEqual({ screen: 'message', params: { id: '77' } });
  });

  it('falls back to the messages list for a missing or malformed id', () => {
    expect(
      getAdminNotificationNavigationTarget({ type: 'customer_message' })
    ).toEqual({ screen: 'messages' });
    expect(
      getAdminNotificationNavigationTarget({
        type: 'customer_message',
        conversation_id: '../orders',
      })
    ).toEqual({ screen: 'messages' });
  });
});
