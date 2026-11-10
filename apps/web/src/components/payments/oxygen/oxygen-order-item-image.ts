import type { z } from 'zod';
import type { oxygenCheckoutOrderSchema } from '@/schemas/oxygen-checkout-order';

type OrderItem = z.infer<
  typeof oxygenCheckoutOrderSchema
>['order_items'][number];

function usableImage(value: string): boolean {
  if (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
  )
    return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

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
    [item.image_url ?? '', ...urls]
      .map((image) => image.trim())
      .find(usableImage) ?? '/placeholder.png'
  );
}
