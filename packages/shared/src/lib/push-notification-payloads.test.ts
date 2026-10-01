import { describe, expect, it } from 'vitest';
import {
  getAdminNotificationNavigationTarget,
  getStorefrontNotificationNavigationTarget,
} from './push-notification-payloads';

describe('getAdminNotificationNavigationTarget', () => {
  it('routes shipment tracking payloads directly to the affected order', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'shipment_tracking',
        orderId: 'order-123',
      })
    ).toEqual({ screen: 'order', params: { id: 'order-123' } });
  });

  it('routes new order payloads directly to the order when order_id is present', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'new_order',
        order_id: 'order-123',
      })
    ).toEqual({
      screen: 'order',
      params: { id: 'order-123' },
    });
  });

  it('routes new invoice payloads directly to the affected order', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'new_invoice',
        order_id: 'order-invoice-123',
      })
    ).toEqual({
      screen: 'order',
      params: { id: 'order-invoice-123' },
    });
  });

  it('falls back to the orders list when the admin payload lacks an order id', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'payment_received',
        order_number: 'ORD-123',
      })
    ).toEqual({ screen: 'orders' });
  });

  it('supports negotiation payloads using camelCase or snake_case ids', () => {
    expect(
      getAdminNotificationNavigationTarget({
        type: 'negotiation',
        negotiationId: 'neg-42',
      })
    ).toEqual({
      screen: 'negotiation',
      params: { id: 'neg-42' },
    });

    expect(
      getAdminNotificationNavigationTarget({
        type: 'negotiation',
        negotiation_id: 'neg-99',
      })
    ).toEqual({
      screen: 'negotiation',
      params: { id: 'neg-99' },
    });
  });
});

describe('getStorefrontNotificationNavigationTarget', () => {
  it('routes shipment tracking payloads directly to the affected order', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'shipment_tracking',
        orderId: 'order-456',
      })
    ).toEqual({ screen: 'order-details', params: { id: 'order-456' } });
  });

  it('routes order update payloads to order details using snake_case order_id', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'order_update',
        order_id: 'order-456',
      })
    ).toEqual({
      screen: 'order-details',
      params: { id: 'order-456' },
    });
  });

  it('routes order update payloads to order details using camelCase orderId', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'order_update',
        orderId: 'order-456',
      })
    ).toEqual({
      screen: 'order-details',
      params: { id: 'order-456' },
    });
  });

  it('routes promotions to product or category pages based on available slug', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'promotion',
        productSlug: 'iphone-17',
      })
    ).toEqual({
      screen: 'product',
      params: { slug: 'iphone-17' },
    });

    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'promotion',
        category_slug: 'laptops',
      })
    ).toEqual({
      screen: 'category',
      params: { slug: 'laptops' },
    });
  });

  it('returns null for null or undefined payload', () => {
    expect(getStorefrontNotificationNavigationTarget(null)).toBeNull();
    expect(getStorefrontNotificationNavigationTarget(undefined)).toBeNull();
  });

  it('returns home for an unknown notification type', () => {
    expect(
      getStorefrontNotificationNavigationTarget({ type: 'unknown_type' })
    ).toEqual({ screen: 'home' });
  });

  it('falls back to orders list when order_update lacks an order id', () => {
    expect(
      getStorefrontNotificationNavigationTarget({ type: 'order_update' })
    ).toEqual({ screen: 'orders' });
  });

  it('routes insurance activation payloads to the order details screen', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'insurance_activation',
        orderId: 'order-789',
      })
    ).toEqual({ screen: 'order-details', params: { id: 'order-789' } });
  });

  it('falls back to orders list when insurance activation lacks an order id', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'insurance_activation',
      })
    ).toEqual({ screen: 'orders' });
  });

  it('falls back to home when promotion has no slug', () => {
    expect(
      getStorefrontNotificationNavigationTarget({ type: 'promotion' })
    ).toEqual({ screen: 'home' });
  });

  it('prefers productSlug over category_slug when both are present', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'promotion',
        productSlug: 'iphone-17',
        category_slug: 'phones',
      })
    ).toEqual({ screen: 'product', params: { slug: 'iphone-17' } });
  });

  it('routes back_in_stock with productSlug to product screen', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'back_in_stock',
        productSlug: 'pixel-9',
      })
    ).toEqual({ screen: 'product', params: { slug: 'pixel-9' } });
  });

  it('routes back_in_stock without slug to home', () => {
    expect(
      getStorefrontNotificationNavigationTarget({ type: 'back_in_stock' })
    ).toEqual({ screen: 'home' });
  });

  it('routes price_drop with product_slug to product screen', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'price_drop',
        product_slug: 'galaxy-s25',
      })
    ).toEqual({ screen: 'product', params: { slug: 'galaxy-s25' } });
  });

  it('routes price_drop without slug to home', () => {
    expect(
      getStorefrontNotificationNavigationTarget({ type: 'price_drop' })
    ).toEqual({ screen: 'home' });
  });

  it('routes negotiation_response with productSlug to product screen', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'negotiation_response',
        productSlug: 'macbook-pro',
      })
    ).toEqual({ screen: 'product', params: { slug: 'macbook-pro' } });
  });

  it('routes negotiation_response without slug to home', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'negotiation_response',
      })
    ).toEqual({ screen: 'home' });
  });

  it('routes VTU cashback monthly summaries to wallet', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'vtu_cashback_monthly_summary',
      })
    ).toEqual({ screen: 'wallet' });
  });

  it('routes customer savings reminders to the savings wallet action', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'customer_savings_reminder',
        goalId: 'goal-1',
      })
    ).toEqual({ screen: 'wallet', params: { action: 'savings' } });
  });

  it('routes customer savings reminders without goal ids to the savings wallet action', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'customer_savings_reminder',
      })
    ).toEqual({ screen: 'wallet', params: { action: 'savings' } });
  });

  it('routes VTU token-ready payloads to utility history', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'vtu_token_ready',
        utilityType: 'power',
      })
    ).toEqual({
      screen: 'utility-history',
      params: { type: 'power' },
    });
  });

  it('routes VTU token-ready payloads using snake_case utility_type', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'vtu_token_ready',
        utility_type: 'power',
      })
    ).toEqual({
      screen: 'utility-history',
      params: { type: 'power' },
    });
  });

  it('routes malformed VTU token-ready payloads home', () => {
    expect(
      getStorefrontNotificationNavigationTarget({
        type: 'vtu_token_ready',
      })
    ).toEqual({ screen: 'home' });
  });
});
