import type { z } from 'zod';
import type { oxygenCheckoutOrderSchema } from '@/schemas/oxygen-checkout-order';

type OrderItem = z.infer<
  typeof oxygenCheckoutOrderSchema
>['order_items'][number];

export function oxygenOrderItemImage(item: OrderItem): string {
  const product = Array.isArray(item.products)
    ? item.products[0]
    : item.products;
  const images = Array.isArray(product?.images) ? product.images : [];
  return (
    item.image_url ||
    images.find(
      (image): image is string =>
        typeof image === 'string' && image.trim().length > 0
    ) ||
    '/placeholder.png'
  );
}
