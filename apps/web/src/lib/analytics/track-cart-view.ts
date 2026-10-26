'use client';

import { isAnalyticsAllowed } from '@/lib/analytics-consent';
import { facebookCatalogEvent } from '@/lib/facebook-catalog-event';
import { isMarketingAllowed } from '@/lib/marketing-consent';
import type { Product } from '@/lib/products';
import { sendFacebookPixelEvent } from './facebook-pixel-client';
import { sendSocialClientObservation } from './send-social-client-observation';
import { trackSocialFunnel } from './track-social-funnel';

type CartItem = { product: Product; quantity: number };
type CartContext = { merchantId: string; userData?: unknown };

/** One browser/server observation identity; no provider credentials in the browser. */
export function trackCartView(
  products: CartItem[],
  currency = 'USD',
  context?: CartContext
): void {
  if (products.length === 0 || (!isAnalyticsAllowed() && !isMarketingAllowed()))
    return;
  const eventId = crypto.randomUUID();
  const value = products.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0
  );
  if (isMarketingAllowed()) {
    trackSocialFunnel(
      'view_item',
      products.map(({ product, quantity }) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        quantity,
      })),
      currency,
      eventId
    );
    if (context?.merchantId)
      for (const destination of ['tiktok', 'snapchat'] as const)
        void sendSocialClientObservation(destination, {
          baseUrl: window.location.origin,
          event: 'view_item',
          eventId,
          merchantId: context.merchantId,
          eventData: {
            value,
            currency,
            products: products.map(({ product, quantity }) => ({
              id: product.id,
              name: product.name,
              price: product.price,
              quantity,
            })),
          },
        });
  }
  if (!isAnalyticsAllowed()) return;
  window.gtag?.('event', 'view_cart', {
    currency,
    value,
    items: products.map(({ product, quantity }) => ({
      item_id: product.id,
      item_name: product.name,
      item_category: product.categories?.name || product.category || undefined,
      price: product.price,
      quantity,
      item_variant: undefined,
    })),
  });
  sendFacebookPixelEvent(
    'ViewContent',
    facebookCatalogEvent({
      content_ids: products.map(({ product }) => product.id),
      content_type: 'product_group',
      content_name: 'Shopping Cart',
      value,
      currency,
      num_items: products.reduce((total, item) => total + item.quantity, 0),
    }),
    { eventID: eventId }
  );

  if (!context?.merchantId) return;
  void fetch('/api/analytics/facebook-capi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'ViewContent',
      eventId,
      consent: true,
      merchantId: context.merchantId,
      eventData: {
        value,
        currency,
        products: products.map(({ product, quantity }) => ({
          id: product.id,
          name: product.name,
          quantity,
          price: product.price,
        })),
      },
      eventSourceUrl: window.location.href,
    }),
  })
    .then((response) => {
      if (!response.ok)
        console.warn('Facebook CAPI observation was not accepted');
    })
    .catch(() => {
      console.warn('Facebook CAPI observation could not be queued');
    });
}
