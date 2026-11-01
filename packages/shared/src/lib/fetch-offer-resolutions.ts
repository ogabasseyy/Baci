import { buildOfferResolutionMap } from './build-offer-resolution-map';
import type { ResolvedOfferResolution } from './coerce-offer-authority-row';
import { isOfferAuthorityId } from './offer-authority-id';
import { OfferAuthorityInputError } from './offer-authority-input-error';

export type OfferAuthorityRpcCall = (args: {
  p_merchant_id: string | null;
  p_product_ids: string[];
}) => Promise<{ data: unknown; error: { message: string } | null }>;

/** A product has at most four condition offers (unique per condition).
 * 200 products therefore stay below PostgREST's 1000-row response cap.
 */
const AUTHORITY_BATCH_SIZE = 200;

/**
 * The one live-offer fetch: batched authority calls (chunked to the
 * response-safe batch size) merged into one map keyed by
 * `productId::offerId`. Chunks run serially by design — merge order
 * stays deterministic and a chunk failure fails the whole lookup
 * closed with no partial map. Throws OfferAuthorityInputError for
 * malformed ids (adapters fail closed) and Error for lookup failures.
 */
export async function fetchOfferResolutions(
  callRpc: OfferAuthorityRpcCall,
  args: { merchantId?: string | null; productIds: readonly string[] }
): Promise<Map<string, ResolvedOfferResolution>> {
  // Null/undefined merchant is unscoped (valid); a supplied merchant
  // must be a uuid — otherwise Postgres raises 22P02 and callers
  // misclassify the lookup as a 500 instead of fail-closed input.
  if (
    args.merchantId !== undefined &&
    args.merchantId !== null &&
    !isOfferAuthorityId(args.merchantId)
  ) {
    throw new OfferAuthorityInputError([args.merchantId]);
  }
  const distinct = Array.from(
    new Set(args.productIds.filter((id) => id !== ''))
  );
  if (distinct.length === 0) return new Map();
  const malformed = distinct.filter((id) => !isOfferAuthorityId(id));
  if (malformed.length > 0) throw new OfferAuthorityInputError(malformed);
  const merged = new Map<string, ResolvedOfferResolution>();
  const batchSize = AUTHORITY_BATCH_SIZE;
  for (let index = 0; index < distinct.length; index += batchSize) {
    const { data, error } = await callRpc({
      p_merchant_id: args.merchantId ?? null,
      p_product_ids: distinct.slice(index, index + batchSize),
    });
    if (error) throw new Error(error.message);
    for (const [key, resolution] of buildOfferResolutionMap(data)) {
      merged.set(key, resolution);
    }
  }
  return merged;
}
