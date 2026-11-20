import { z } from 'zod';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { productionOrigin } from '@/lib/experience/production-origins';

/** Exact anonymous product projection; credentials and transport are host-owned. */
export function createPublicProductPolicy(settings: {
  origin: string;
  merchantId: string;
  productId: string;
}) {
  const origin = productionOrigin(settings.origin);
  const merchantId = z.uuid().parse(settings.merchantId);
  const productId = z.uuid().parse(settings.productId);
  const expected = new Map([
    ['select', HYDRATION_SELECT.replace(/\s+/g, '')],
    ['merchant_id', `eq.${merchantId}`],
    ['id', `in.(${productId})`],
    ['status', 'eq.active'],
  ]);
  return (request: { url: string; method: string }) => {
    try {
      if (request.method !== 'GET' || request.url.length > 4096) return false;
      const url = new URL(request.url);
      if (
        url.href !== request.url ||
        url.origin !== origin ||
        url.pathname !== '/rest/v1/products' ||
        url.hash ||
        url.username ||
        url.password
      )
        return false;
      const params = [...url.searchParams.entries()];
      return (
        params.length === expected.size &&
        params.every(([key, value]) => expected.get(key) === value) &&
        new Set(params.map(([key]) => key)).size === expected.size
      );
    } catch {
      return false;
    }
  };
}
