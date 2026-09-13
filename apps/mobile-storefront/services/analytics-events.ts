import {
  type AnalyticsProperties,
  buildCheckoutFunnelProperties,
  buildCheckoutStartedProperties,
  buildCheckoutStepCompletedProperties,
  buildOrderCompletedProperties,
  buildPaymentFailedProperties,
  buildProductAddedProperties,
  buildProductListViewedProperties,
  buildProductRemovedProperties,
  buildProductsSearchedProperties,
  buildProductViewedProperties,
  buildWishlistProductProperties,
  CHECKOUT_FUNNEL_EVENTS,
  type CheckoutStepName,
  compactAnalyticsProperties,
  ECOMMERCE_ANALYTICS_EVENTS,
  eventForWishlistAction,
  getCheckoutPaymentIntent,
  type WishlistAction,
} from '@baci/shared/contracts';
import { trackEvent } from './analytics-core';

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

export function trackCheckoutStarted(checkout: {
  cartId?: string;
  itemCount: number;
  subtotal: number;
  currency?: string;
}): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.checkoutStarted,
    buildCheckoutStartedProperties(checkout)
  );
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.checkoutStarted,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      itemCount: checkout.itemCount,
      source: 'mobile_app',
      subtotal: checkout.subtotal,
      total: checkout.subtotal,
    })
  );
}

export function trackCheckoutStep(
  step: CheckoutStepName,
  properties?: AnalyticsProperties
): void {
  trackEvent(
    ECOMMERCE_ANALYTICS_EVENTS.checkoutStepCompleted,
    buildCheckoutStepCompletedProperties(step, properties)
  );
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.checkoutStepCompleted,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      checkoutStep: step,
      properties,
      source: 'mobile_app',
    })
  );
}

export function trackCheckoutPaymentMethodSelected(
  paymentMethod: string
): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentMethodSelected,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      paymentIntent: getCheckoutPaymentIntent(paymentMethod),
      paymentMethod,
      source: 'mobile_app',
    })
  );
}

export function trackCheckoutOrderCreated(order: {
  orderId: string;
  orderNumber: string;
  total: number;
  itemCount: number;
  paymentMethod: string;
  paymentStatus?: string;
  durationMs?: number;
  subtotal?: number;
  shipping?: number;
  tax?: number;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.orderCreated,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      durationMs: order.durationMs,
      itemCount: order.itemCount,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      paymentIntent: getCheckoutPaymentIntent(order.paymentMethod),
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      shipping: order.shipping,
      source: 'mobile_app',
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
    })
  );
}

export function trackCheckoutInvoiceGenerated(order: {
  orderId: string;
  orderNumber: string;
  total: number;
  itemCount: number;
  paymentMethod?: string;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.invoiceGenerated,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      itemCount: order.itemCount,
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      paymentIntent: 'proforma_invoice',
      paymentMethod: order.paymentMethod || 'invoice',
      paymentStatus: 'unpaid',
      source: 'mobile_app',
      total: order.total,
    })
  );
}

export function trackCheckoutPaymentStarted(input: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  value?: number;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentStarted,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      paymentIntent: getCheckoutPaymentIntent(input.paymentMethod),
      paymentMethod: input.paymentMethod,
      source: 'mobile_app',
      total: input.value,
    })
  );
}

export function trackCheckoutPaymentCompleted(input: {
  orderId: string;
  orderNumber?: string;
  paymentMethod: string;
  reference?: string;
  value?: number;
}): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentCompleted,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      paymentIntent: getCheckoutPaymentIntent(input.paymentMethod),
      paymentMethod: input.paymentMethod,
      paymentStatus: 'paid',
      reference: input.reference,
      source: 'mobile_app',
      total: input.value,
    })
  );
}

export function trackCheckoutPaymentFailed(
  reason: string,
  orderId?: string,
  paymentMethod?: string
): void {
  trackEvent(
    CHECKOUT_FUNNEL_EVENTS.paymentFailed,
    buildCheckoutFunnelProperties({
      channel: 'mobile_app',
      orderId,
      paymentIntent: paymentMethod
        ? getCheckoutPaymentIntent(paymentMethod)
        : undefined,
      paymentMethod,
      reason,
      source: 'mobile_app',
    })
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
