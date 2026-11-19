import { CART_REQUEST_TIMEOUT_MS } from '@/hooks/cart/cart-request-deadline';
import { invalidateCustomerIdentityObservers } from './customer-live-identity';

/** Session cookies can change even when a response is lost or unsuccessful. */
export async function fetchCustomerAuthMutation(
  merchantSlug: string,
  url: string,
  init: RequestInit
): Promise<Response> {
  invalidateCustomerIdentityObservers(merchantSlug);
  try {
    return await fetch(url, init);
  } finally {
    invalidateCustomerIdentityObservers(merchantSlug);
  }
}

export function postCustomerAuthLogout(
  merchantSlug: string
): Promise<Response> {
  return fetchCustomerAuthMutation(
    merchantSlug,
    '/api/storefront/auth/logout',
    {
      method: 'POST',
      signal:
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(CART_REQUEST_TIMEOUT_MS)
          : undefined,
    }
  );
}
