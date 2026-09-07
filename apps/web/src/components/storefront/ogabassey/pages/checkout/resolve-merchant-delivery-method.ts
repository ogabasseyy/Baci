import { resolveEligibleWebStorefrontDeliveryMethod } from '@baci/shared';
import type { DeliveryMethod } from './types';

export function resolveMerchantDeliveryMethod(
  method: DeliveryMethod,
  state: string,
  merchantSlug?: string
): DeliveryMethod {
  // These legacy options use Ogabassey's fixed pickup location. Other merchants must supply their own quoted delivery options.
  if (merchantSlug !== 'ogabassey' && method === 'pickup') return 'door';
  return resolveEligibleWebStorefrontDeliveryMethod(method, state);
}
