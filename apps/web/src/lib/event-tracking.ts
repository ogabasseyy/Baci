'use client';

import { analytics } from '@/lib/analytics';
import type { AnalyticsProduct } from '@/lib/analytics/analytics-product';
import { buildProductEvent } from '@/lib/analytics/build-product-event';
import { sendTrackedEvent } from '@/lib/analytics/send-tracked-event';
import type {
  PageViewEvent,
  ProductEvent,
  PurchaseEvent,
  SearchEvent,
} from '@/lib/analytics/tracked-event-types';
import { sanitizeTrackingUrl } from '@/lib/privacy/sanitize-tracking-url';

export type { EventType } from '@/lib/analytics/tracked-event-types';

/**
 * Event Tracking System for Baci
 *
 * Tracks user events and stores them in Supabase for merchant analytics dashboard.
 * Also forwards events to GA4 and Facebook Pixel for external analytics.
 * For purchase events, also sends server-side events via Facebook Conversions API.
 */

/**
 * Track events - stores in Supabase AND sends to GA4/Facebook
 */
export const trackEvent = {
  /**
   * Track product view
   */
  productView: (
    merchantId: string,
    product: AnalyticsProduct,
    currency: string = 'USD'
  ) => {
    const eventId = crypto.randomUUID();
    // Store in Supabase for merchant dashboard
    sendTrackedEvent(
      buildProductEvent({
        currency,
        eventId,
        eventType: 'product_view',
        merchantId,
        product,
      })
    );

    // Also send to GA4/Facebook
    analytics.viewItem(product, currency, eventId);
  },

  /**
   * Track add to cart
   */
  addToCart: (
    merchantId: string,
    product: AnalyticsProduct,
    quantity: number = 1,
    currency: string = 'USD'
  ) => {
    const eventId = crypto.randomUUID();
    sendTrackedEvent(
      buildProductEvent({
        currency,
        eventId,
        eventType: 'add_to_cart',
        merchantId,
        product,
        quantity,
      })
    );

    analytics.addToCart(product, quantity, currency, undefined, eventId);
  },

  /**
   * Track remove from cart
   */
  removeFromCart: (
    merchantId: string,
    product: AnalyticsProduct,
    quantity: number = 1,
    currency: string = 'USD'
  ) => {
    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName =
      product.categories?.name || product.category || undefined;

    sendTrackedEvent({
      event_type: 'remove_from_cart',
      merchant_id: merchantId,
      product_id: product.id,
      product_name: product.name,
      product_category: categoryName,
      product_price: product.price,
      quantity,
      currency,
    } satisfies ProductEvent);

    analytics.removeFromCart(product, quantity, currency);
  },

  /**
   * Track checkout started
   */
  beginCheckout: (
    merchantId: string,
    products: Array<{ product: AnalyticsProduct; quantity: number }>,
    currency: string = 'USD'
  ) => {
    const eventId = crypto.randomUUID();
    const total = products.reduce(
      (sum, { product, quantity }) => sum + product.price * quantity,
      0
    );

    sendTrackedEvent({
      event_id: eventId,
      event_type: 'begin_checkout',
      merchant_id: merchantId,
      order_id: '', // Will be assigned later
      total,
      subtotal: total,
      currency,
      item_count: products.reduce((sum, p) => sum + p.quantity, 0),
      items: products.map(({ product, quantity }) => ({
        product_id: product.id,
        product_name: product.name,
        price: product.price,
        quantity,
      })),
    } satisfies PurchaseEvent);

    analytics.beginCheckout(products, currency, eventId);
  },

  /**
   * Track purchase complete
   */
  purchase: (
    merchantId: string,
    orderId: string,
    products: Array<{ product: AnalyticsProduct; quantity: number }>,
    total: number,
    currency: string = 'USD',
    shipping?: number,
    tax?: number
  ) => {
    const subtotal = products.reduce(
      (sum, { product, quantity }) => sum + product.price * quantity,
      0
    );

    sendTrackedEvent({
      event_type: 'purchase',
      merchant_id: merchantId,
      order_id: orderId,
      total,
      subtotal,
      shipping,
      tax,
      currency,
      item_count: products.reduce((sum, p) => sum + p.quantity, 0),
      items: products.map(({ product, quantity }) => ({
        product_id: product.id,
        product_name: product.name,
        price: product.price,
        quantity,
      })),
    } satisfies PurchaseEvent);

    analytics.purchase(orderId, products, total, currency, tax, shipping);
  },

  /**
   * Track search
   */
  search: (merchantId: string, searchTerm: string, resultsCount?: number) => {
    sendTrackedEvent({
      event_type: 'search',
      merchant_id: merchantId,
      search_term: searchTerm,
      results_count: resultsCount,
    } satisfies SearchEvent);

    analytics.search(searchTerm);
  },

  /**
   * Track add to wishlist
   */
  addToWishlist: (
    merchantId: string,
    product: AnalyticsProduct,
    currency: string = 'USD'
  ) => {
    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName =
      product.categories?.name || product.category || undefined;

    sendTrackedEvent({
      event_type: 'add_to_wishlist',
      merchant_id: merchantId,
      product_id: product.id,
      product_name: product.name,
      product_category: categoryName,
      product_price: product.price,
      currency,
    } satisfies ProductEvent);

    analytics.addToWishlist(product, currency);
  },

  /**
   * Track page view
   */
  pageView: (merchantId: string, pageUrl: string, pageTitle?: string) => {
    sendTrackedEvent({
      event_type: 'page_view',
      merchant_id: merchantId,
      page_url: sanitizeTrackingUrl(pageUrl),
    } satisfies PageViewEvent);

    analytics.pageView(pageUrl, pageTitle);
  },
};
