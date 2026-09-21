import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BackfillImageCandidate,
  ClassifiedImage,
} from '../../packages/shared/src/gmc-feed/index';
import { appendOfferImageCandidates } from './feed-offer-image-backfill';

export interface OfferProductImageInput {
  supabase: SupabaseClient;
  products: ReadonlyArray<{
    id: string;
    condition?: string | null;
    has_condition_offers?: boolean | null;
  }>;
  merchantId: string;
  storefrontBaseUrl: string;
  productRows: ReadonlyArray<{
    candidate: BackfillImageCandidate;
    classified: ClassifiedImage;
  }>;
}

/**
 * Merge condition-offer imagery into the classified rows. Only flagged
 * products are eligible: feed hydration skips the offers relation
 * otherwise, so unflagged offer rows could never build an exclusion set
 * and would leak into base product imagery. Throws on query failure so
 * the caller can fail the backfill loudly.
 */
export async function appendOfferProductImages(
  input: OfferProductImageInput
): Promise<
  Array<{ candidate: BackfillImageCandidate; classified: ClassifiedImage }>
> {
  const { supabase, products, merchantId, storefrontBaseUrl, productRows } =
    input;
  const offerProducts = products.filter(
    (product) => product.has_condition_offers
  );
  return appendOfferImageCandidates({
    supabase,
    productIds: offerProducts.map((product) => product.id),
    merchantId,
    storefrontBaseUrl,
    productRows,
    productConditions: new Map(
      offerProducts.map((product) => [product.id, product.condition])
    ),
  });
}
