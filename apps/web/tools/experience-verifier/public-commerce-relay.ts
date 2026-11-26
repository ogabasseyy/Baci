import { createPublicProductPolicy } from './public-product-policy';

type Request = { url: string; method: 'GET' | 'POST'; body?: string };
type Reply = { status: number; body: string };

/** The cart and anonymous product readers independently enforce their own scope. */
export function createPublicCommerceRelay(settings: {
  product: { origin: string; merchantId: string; productId: string };
  readProduct(request: Request): Promise<Reply>;
  cart(request: Request): Promise<Reply>;
}) {
  const isProduct = createPublicProductPolicy(settings.product);
  return (request: Request) => {
    if (isProduct(request)) {
      if (request.body !== undefined)
        return Promise.reject(Error('PUBLIC_PRODUCT_REQUEST_DENIED'));
      return settings.readProduct(request);
    }
    return settings.cart(request);
  };
}
