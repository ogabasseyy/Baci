import type { TrackedOrder, TrackedWishlistProduct } from './ad-tracking.types';
import { posthogOrderCompleted, posthogTrack } from './ad-tracking-identity';
import {
  generateEventId,
  generateEventIdSync,
  trackAemEvent,
  trackFacebookEvent,
  trackFacebookPurchase,
  trackTikTokEvent,
} from './ad-tracking-runtime';
import { sendServerConversion } from './ad-tracking-server-conversion';
import { adTrackingLog as log } from './ad-tracking-state';
import { buildTikTokCommerceEventParams } from './tiktok-commerce-event-data';

export async function trackPurchase(order: TrackedOrder): Promise<void> {
  const eventId = await generateEventId();
  const currency = order.currency || 'NGN';
  const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const tikTokParams = buildTikTokCommerceEventParams({
    currency,
    value: order.total,
    quantity: totalItems,
    items: order.items,
    extra: { order_id: order.orderId },
  });

  posthogOrderCompleted({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    total: order.total,
    subtotal: order.subtotal,
    shipping: order.shipping,
    tax: order.tax,
    currency,
    itemCount: order.items.length,
    paymentMethod: order.paymentMethod,
    couponCode: order.couponCode,
  });

  sendServerConversion('PURCHASE', eventId, {
    orderId: order.orderId,
    value: order.total,
    currency,
    email: order.email,
    phone: order.phone,
    userId: order.userId,
    items: order.items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      name: item.name,
      price: item.price,
    })),
  });

  trackFacebookPurchase(order.total, currency, {
    fb_order_id: order.orderId,
    fb_content_type: 'product_group',
    fb_content_id: JSON.stringify(order.items.map((item) => item.id)),
    fb_num_items: totalItems,
    _eventId: eventId,
  });
  trackAemEvent('fb_mobile_purchase', order.total, currency, {
    fb_order_id: order.orderId,
    fb_num_items: order.items.length,
  });
  trackTikTokEvent('Purchase', eventId, tikTokParams);
  log.info(`Purchase tracked: ${order.orderId} - ${order.total} ${currency}`);
}

// biome-ignore lint/suspicious/useAwait: async isolates tracking failures as promise rejections so a broken analytics provider can never crash the caller's user-facing flow (Codex review, #3084)
export async function trackPaymentInfoAdded(
  paymentMethod: string
): Promise<void> {
  const eventId = generateEventIdSync();

  sendServerConversion('ADD_PAYMENT_INFO', eventId, { currency: 'NGN' });
  trackFacebookEvent('fb_mobile_add_payment_info', { _eventId: eventId });
  trackAemEvent('fb_mobile_add_payment_info', 0, 'NGN', {});
  trackTikTokEvent('AddPaymentInfo', eventId, {
    payment_method: paymentMethod,
    currency: 'NGN',
  });
}

// biome-ignore lint/suspicious/useAwait: async isolates tracking failures as promise rejections so a broken analytics provider can never crash the caller's user-facing flow (Codex review, #3084)
export async function trackAddToWishlist(
  product: TrackedWishlistProduct
): Promise<void> {
  const eventId = generateEventIdSync();
  const currency = product.currency || 'NGN';
  const tikTokParams = buildTikTokCommerceEventParams({
    contentId: product.id,
    contentName: product.name,
    currency,
    value: product.price,
    items: [{ ...product, quantity: 1 }],
  });

  posthogTrack('Wishlist Item Added', {
    product_id: product.id,
    product_name: product.name,
    price: product.price,
    currency,
    category: product.category,
    brand: product.brand,
  });

  sendServerConversion('ADD_TO_WISHLIST', eventId, {
    value: product.price,
    currency,
    contentName: product.name,
    contentType: 'product',
    price: product.price,
    items: [
      {
        id: product.id,
        quantity: 1,
        name: product.name,
        price: product.price,
      },
    ],
  });

  trackTikTokEvent('AddToWishlist', eventId, tikTokParams);
}
