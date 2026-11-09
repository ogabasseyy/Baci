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
  const urls = images.map((image: unknown) =>
    typeof image === 'string'
      ? image
      : typeof image === 'object' &&
          image !== null &&
          'url' in image &&
          typeof image.url === 'string'
        ? image.url
        : ''
  );
  return (
    item.image_url?.trim() ||
    urls.find((image) => image.trim().length > 0)?.trim() ||
    '/placeholder.png'
  );
}
