import type { AnalyticsProduct } from './analytics-product';
import type { ProductEvent } from './tracked-event-types';

/** `/api/events` payload for a product-level funnel event. */
export function buildProductEvent({
  currency,
  eventId,
  eventType,
  merchantId,
  product,
  quantity,
}: {
  currency: string;
  eventId?: string;
  eventType: ProductEvent['event_type'];
  merchantId: string;
  product: AnalyticsProduct;
  quantity?: number;
}): ProductEvent {
  return {
    ...(eventId ? { event_id: eventId } : {}),
    event_type: eventType,
    merchant_id: merchantId,
    product_id: product.id,
    product_name: product.name,
    // Joined categories.name first, then the legacy TEXT field.
    product_category: product.categories?.name || product.category || undefined,
    product_price: product.price,
    ...(quantity === undefined ? {} : { quantity }),
    currency,
  };
}
