import { resolveEligibleWebStorefrontDeliveryMethod } from '@baci/shared';
import type { DeliveryMethod } from './types';

/** The historical Ikeja shop collection option belongs only to Ogabassey. */
export function resolveCheckoutDeliveryMethod(
  method: DeliveryMethod,
  state: string,
  merchantSlug: string | null | undefined,
): DeliveryMethod {
  if (method === 'pickup' && merchantSlug !== 'ogabassey') return 'door';
  return resolveEligibleWebStorefrontDeliveryMethod(method, state);
}
