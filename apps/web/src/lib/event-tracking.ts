'use client';

import { analytics } from '@/lib/analytics';
import { isAnalyticsAllowed } from '@/lib/analytics-consent';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import type { Product } from '@/lib/products';

/**
 * Event Tracking System for Baci
 *
 * Tracks user events and stores them in Supabase for merchant analytics dashboard.
 * Also forwards events to GA4 and Facebook Pixel for external analytics.
 * For purchase events, also sends server-side events via Facebook Conversions API.
 */

// Event types for the database
export type EventType =
  | 'page_view'
  | 'product_view'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'begin_checkout'
  | 'purchase'
  | 'search'
  | 'add_to_wishlist'
  | 'share';

interface BaseEvent {
  event_type: EventType;
  event_id?: string;
  merchant_id: string;
  session_id?: string;
  user_agent?: string;
  referrer?: string;
  page_url?: string;
}

interface ProductEvent extends BaseEvent {
  product_id: string;
  product_name: string;
  product_category?: string;
  product_price: number;
  quantity?: number;
  currency: string;
}

interface PurchaseEvent extends BaseEvent {
  order_id: string;
  total: number;
  subtotal: number;
  shipping?: number;
  tax?: number;
  currency: string;
  item_count: number;
  items: Array<{
    product_id: string;
    product_name: string;
    price: number;
    quantity: number;
  }>;
}

interface SearchEvent extends BaseEvent {
  search_term: string;
  results_count?: number;
}

// Get or create session ID
function getSessionId(): string {
  if (typeof window === 'undefined') return '';

  let sessionId = sessionStorage.getItem('baci_session_id');
  if (!sessionId) {
    // Use crypto.randomUUID() for cryptographically secure session IDs
    sessionId = `sess_${crypto.randomUUID()}`;
    sessionStorage.setItem('baci_session_id', sessionId);
  }
  return sessionId;
}

// Get common event metadata
function getEventMetadata(): Partial<BaseEvent> {
  if (typeof window === 'undefined') return {};

  return {
    session_id: getSessionId(),
    user_agent: navigator.userAgent,
    referrer: document.referrer || undefined,
    page_url: window.location.href,
  };
}

// Send event to our API (stores in Supabase)
async function sendEvent(
  event: BaseEvent | ProductEvent | PurchaseEvent | SearchEvent
): Promise<void> {
  try {
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...event,
        ...getEventMetadata(),
        analytics_consent: isAnalyticsAllowed(),
        marketing_consent: isMarketingAllowed(),
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.warn('Failed to track event:', event.event_type);
    }
  } catch (error) {
    // Silently fail - don't break user experience for analytics
    console.warn('Event tracking error:', error);
  }
}

/**
 * Track events - stores in Supabase AND sends to GA4/Facebook
 */
export const trackEvent = {
  /**
   * Track product view
   */
  productView: (
    merchantId: string,
    product: Product,
    currency: string = 'USD'
  ) => {
    const eventId = crypto.randomUUID();
    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName =
      product.categories?.name || product.category || undefined;

    // Store in Supabase for merchant dashboard
    sendEvent({
      event_id: eventId,
      event_type: 'product_view',
      merchant_id: merchantId,
      product_id: product.id,
      product_name: product.name,
      product_category: categoryName,
      product_price: product.price,
      currency,
    } as ProductEvent);

    // Also send to GA4/Facebook
    analytics.viewItem(product, currency, eventId);
  },

  /**
   * Track add to cart
   */
  addToCart: (
    merchantId: string,
    product: Product,
    quantity: number = 1,
    currency: string = 'USD'
  ) => {
    const eventId = crypto.randomUUID();
    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName =
      product.categories?.name || product.category || undefined;

    sendEvent({
      event_id: eventId,
      event_type: 'add_to_cart',
      merchant_id: merchantId,
      product_id: product.id,
      product_name: product.name,
      product_category: categoryName,
      product_price: product.price,
      quantity,
      currency,
    } as ProductEvent);

    analytics.addToCart(product, quantity, currency, undefined, eventId);
  },

  /**
   * Track remove from cart
   */
  removeFromCart: (
    merchantId: string,
    product: Product,
    quantity: number = 1,
    currency: string = 'USD'
  ) => {
    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName =
      product.categories?.name || product.category || undefined;

    sendEvent({
      event_type: 'remove_from_cart',
      merchant_id: merchantId,
      product_id: product.id,
      product_name: product.name,
      product_category: categoryName,
      product_price: product.price,
      quantity,
      currency,
    } as ProductEvent);

    analytics.removeFromCart(product, quantity, currency);
  },

  /**
   * Track checkout started
   */
  beginCheckout: (
    merchantId: string,
    products: Array<{ product: Product; quantity: number }>,
    currency: string = 'USD'
  ) => {
    const eventId = crypto.randomUUID();
    const total = products.reduce(
      (sum, { product, quantity }) => sum + product.price * quantity,
      0
    );

    sendEvent({
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
    } as PurchaseEvent);

    analytics.beginCheckout(products, currency, eventId);
  },

  /**
   * Track purchase complete
   */
  purchase: (
    merchantId: string,
    orderId: string,
    products: Array<{ product: Product; quantity: number }>,
    total: number,
    currency: string = 'USD',
    shipping?: number,
    tax?: number
  ) => {
    const subtotal = products.reduce(
      (sum, { product, quantity }) => sum + product.price * quantity,
      0
    );

    sendEvent({
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
    } as PurchaseEvent);

    analytics.purchase(orderId, products, total, currency, tax, shipping);
  },

  /**
   * Track search
   */
  search: (merchantId: string, searchTerm: string, resultsCount?: number) => {
    sendEvent({
      event_type: 'search',
      merchant_id: merchantId,
      search_term: searchTerm,
      results_count: resultsCount,
    } as SearchEvent);

    analytics.search(searchTerm);
  },

  /**
   * Track add to wishlist
   */
  addToWishlist: (
    merchantId: string,
    product: Product,
    currency: string = 'USD'
  ) => {
    // Use joined categories.name from category_id, fallback to legacy TEXT field
    const categoryName =
      product.categories?.name || product.category || undefined;

    sendEvent({
      event_type: 'add_to_wishlist',
      merchant_id: merchantId,
      product_id: product.id,
      product_name: product.name,
      product_category: categoryName,
      product_price: product.price,
      currency,
    } as ProductEvent);

    analytics.addToWishlist(product, currency);
  },

  /**
   * Track page view
   */
  pageView: (merchantId: string, pageUrl: string, pageTitle?: string) => {
    sendEvent({
      event_type: 'page_view',
      merchant_id: merchantId,
      page_url: pageUrl,
    } as BaseEvent);

    analytics.pageView(pageUrl, pageTitle);
  },
};
