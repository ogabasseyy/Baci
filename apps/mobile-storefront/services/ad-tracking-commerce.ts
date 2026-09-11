import type {
  TrackedCartProduct,
  TrackedCheckout,
  TrackedProduct,
} from './ad-tracking.types';
import { posthogAddToCart, posthogProductViewed } from './ad-tracking-identity';
import { generateEventIdSync, sendClientBackup } from './ad-tracking-runtime';
import { sendServerConversion } from './ad-tracking-server-conversion';
import { buildTikTokCommerceEventParams } from './tiktok-commerce-event-data';

// biome-ignore lint/suspicious/useAwait: async isolates tracking failures as promise rejections so a broken analytics provider can never crash the caller's user-facing flow (Codex review, #3084)
export async function trackProductViewed(
  product: TrackedProduct
): Promise<void> {
  const eventId = generateEventIdSync();
  const currency = product.currency || 'NGN';
  const tikTokParams = buildTikTokCommerceEventParams({
    contentId: product.id,
    contentName: product.name,
    currency,
    description: product.description,
    value: product.price,
    items: [{ ...product, quantity: 1 }],
  });

  posthogProductViewed({
    id: product.id,
    name: product.name,
    price: product.price,
    currency,
    category: product.category,
  });

  sendServerConversion('VIEW_CONTENT', eventId, {
    value: product.price,
    currency,
    items: [
      { id: product.id, quantity: 1, name: product.name, price: product.price },
    ],
  });

  sendClientBackup(
    eventId,
    'fb_mobile_content_view',
    'ViewContent',
    product.price,
    currency,
    {
      fb_content_id: product.id,
      fb_content_type: 'product_group',
      fb_currency: currency,
    },
    tikTokParams
  );
}

// biome-ignore lint/suspicious/useAwait: async isolates tracking failures as promise rejections so a broken analytics provider can never crash the caller's user-facing flow (Codex review, #3084)
export async function trackAddToCart(
  product: TrackedCartProduct,
  cartTotal?: number
): Promise<void> {
  const eventId = generateEventIdSync();
  const currency = product.currency || 'NGN';
  const value = product.price * product.quantity;
  const tikTokParams = buildTikTokCommerceEventParams({
    contentId: product.id,
    contentName: product.name,
    currency,
    value,
    items: [product],
  });

  posthogAddToCart(
    {
      id: product.id,
      name: product.name,
      price: product.price,
      quantity: product.quantity,
      currency,
      category: product.category,
    },
    cartTotal
  );

  sendServerConversion('ADD_CART', eventId, {
    value,
    currency,
    items: [
      {
        id: product.id,
        quantity: product.quantity,
        name: product.name,
        price: product.price,
      },
    ],
  });

  sendClientBackup(
    eventId,
    'fb_mobile_add_to_cart',
    'AddToCart',
    value,
    currency,
    {
      fb_content_id: product.id,
      fb_content_type: 'product_group',
      fb_currency: currency,
      fb_num_items: product.quantity,
    },
    tikTokParams
  );
}

// biome-ignore lint/suspicious/useAwait: caller (use-checkout-address-state.ts) chains .catch() on this Promise, so the async/Promise<void> signature is required
export async function trackCheckoutStarted(
  checkout: TrackedCheckout
): Promise<void> {
  const eventId = generateEventIdSync();
  const currency = checkout.currency || 'NGN';
  const tikTokParams = buildTikTokCommerceEventParams({
    currency,
    value: checkout.subtotal,
    quantity: checkout.itemCount,
    items: checkout.items,
  });

  sendServerConversion('START_CHECKOUT', eventId, {
    value: checkout.subtotal,
    currency,
    items: checkout.items?.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      name: item.name,
      price: item.price,
    })),
  });

  sendClientBackup(
    eventId,
    'fb_mobile_initiated_checkout',
    'Checkout',
    checkout.subtotal,
    currency,
    {
      fb_currency: currency,
      fb_num_items: checkout.itemCount,
    },
    tikTokParams
  );
}
