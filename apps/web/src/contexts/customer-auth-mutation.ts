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
