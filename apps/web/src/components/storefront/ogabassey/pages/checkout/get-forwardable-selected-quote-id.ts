import type { DeliveryMethod } from './types';
import { getMerchantRateId } from './get-merchant-rate-id';

/**
 * The quote id safe to forward to the order-create and order-reuse APIs as
 * `selected_quote_id`.
 *
 * Returns `undefined` (i.e. "send nothing") when:
 *   - the method has no third-party quote (pickup/airport), or
 *   - the selection is a merchant rate. Merchant rates carry a synthetic
 *     `mrate_<uuid>` id that is NOT a persisted quote row — the server
 *     recomputes their fee from `shipping_rate_id` instead. Both the reuse
 *     route (`z.uuid()` on `selected_quote_id`) and the order-create RPC reject
 *     the synthetic id, so it must never be forwarded. The reuse route reopens
 *     an already-fee-verified pending order and does not re-verify shipping, so
 *     omitting it is safe.
 */
export function getForwardableSelectedQuoteId(
  deliveryMethod: DeliveryMethod,
  selectedQuoteId: string,
): string | undefined {
  if (deliveryMethod !== 'door' && deliveryMethod !== 'pickup_station') {
    return undefined;
  }
  if (getMerchantRateId(selectedQuoteId)) {
    return undefined;
  }
  return selectedQuoteId || undefined;
}
