'use client';

import { isAnalyticsAllowed } from '@/lib/analytics-consent';
import { facebookCatalogEvent } from '@/lib/facebook-catalog-event';
import type { Product } from '@/lib/products';

type CartItem = { product: Product; quantity: number };
type CartContext = { merchantId: string; userData?: unknown };

/** One browser/server observation identity; no provider credentials in the browser. */
export function trackCartView(
  products: CartItem[],
  currency = 'USD',
  context?: CartContext
): void {
  if (!isAnalyticsAllowed()) return;
  const eventId = crypto.randomUUID();
  const value = products.reduce(
    (total, item) => total + item.product.price * item.quantity,
    0
  );
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
  window.fbq?.(
    'track',
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
