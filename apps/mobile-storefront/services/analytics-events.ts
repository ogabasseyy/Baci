import {
  type AnalyticsProperties,
  buildOrderCompletedProperties,
  buildPaymentFailedProperties,
  buildProductAddedProperties,
  buildProductListViewedProperties,
  buildProductRemovedProperties,
  buildProductsSearchedProperties,
  buildProductViewedProperties,
  buildWishlistProductProperties,
  compactAnalyticsProperties,
  ECOMMERCE_ANALYTICS_EVENTS,
  eventForWishlistAction,
  type WishlistAction,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

export {
  trackCheckoutInvoiceGenerated,
  trackCheckoutOrderCreated,
  trackCheckoutPaymentCompleted,
  trackCheckoutPaymentFailed,
  trackCheckoutPaymentMethodSelected,
  trackCheckoutPaymentStarted,
  trackCheckoutStarted,
  trackCheckoutStep,
} from './analytics-checkout-events';

export function trackProductViewed(product: {
  id: string;
  name: string;
  price: number;
  currency?: string;
  category?: string;
  brand?: string;
  slug?: string;
  sku?: string;
  variant?: string;
  imageUrl?: string;
}): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.productViewed,
    buildProductViewedProperties(product)
  );
}

export function trackAddToCart(
  product: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    currency?: string;
    category?: string;
    brand?: string;
    sku?: string;
    variant?: string;
    slug?: string;
    imageUrl?: string;
  },
  cartValue?: number
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.productAdded,
    buildProductAddedProperties(product, cartValue)
  );
}

export function trackRemoveFromCart(product: {
  id: string;
  name: string;
  price: number;
  quantity: number;
  currency?: string;
  category?: string;
  brand?: string;
  sku?: string;
  variant?: string;
}): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.productRemoved,
    buildProductRemovedProperties(product)
  );
}

export function trackOrderCompleted(order: {
  orderId: string;
  orderNumber: string;
  total: number;
  subtotal: number;
  shipping?: number;
  tax?: number;
  currency?: string;
  itemCount: number;
  paymentMethod?: string;
  couponCode?: string;
}): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.orderCompleted,
    buildOrderCompletedProperties(order)
  );
}

export function trackPaymentFailed(reason: string, orderId?: string): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.paymentFailed,
    buildPaymentFailedProperties(reason, orderId)
  );
}

export function trackSearch(
  query: string,
  resultCount: number,
  filters?: AnalyticsProperties
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.productsSearched,
    buildProductsSearchedProperties(query, resultCount, filters)
  );
}

export function trackCategoryViewed(
  categoryName: string,
  categorySlug: string,
  productCount?: number
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.productListViewed,
    buildProductListViewedProperties({
      name: categoryName,
      slug: categorySlug,
      productCount,
    })
  );
}

export function trackWishlistAction(
  action: WishlistAction,
  product: { id: string; name: string }
): void {
  trackEvent(
    eventForWishlistAction(action),
    buildWishlistProductProperties(product)
  );
}

export function trackShare(
  contentType: 'product' | 'category' | 'order',
  contentId: string,
  method?: string
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.contentShared,
    compactAnalyticsProperties({
      content_type: contentType,
      content_id: contentId,
      share_method: method,
    })
  );
}

export function trackNotificationInteraction(
  action: 'received' | 'opened' | 'dismissed',
  notificationType: string,
  notificationId?: string
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.notificationInteraction,
    compactAnalyticsProperties({
      action,
      notification_type: notificationType,
      notification_id: notificationId,
    })
  );
}

export function trackAppReviewPrompt(
  action: 'shown' | 'accepted' | 'declined' | 'later'
): void {
  trackEvent(ECOMMERCE_ANALYTICS_EVENTS.appReviewPrompt, { action });
}

export function trackTiming(
  category: string,
  variable: string,
  durationMs: number,
  label?: string
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.timing,
    compactAnalyticsProperties({
      timing_category: category,
      timing_variable: variable,
      timing_value: durationMs,
      timing_label: label,
    })
  );
}

export function trackError(
  errorType: string,
  errorMessage: string,
  context?: AnalyticsProperties
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.error,
    compactAnalyticsProperties({
      error_type: errorType,
      error_message: errorMessage,
      ...context,
    })
  );
}
