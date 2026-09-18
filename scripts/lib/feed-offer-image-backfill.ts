/**
 * Offer-image backfill orchestration for `product_feed_images`.
 *
 * Loads active condition offers for the resolved merchant and merges their
 * image candidates into the product candidate set. Offer rows are scoped by
 * BOTH product IDs and merchant_id: the staff insert policy authorizes the
 * supplied merchant_id without checking product ownership, so an
 * unscoped service-role read could verify an attacker's URL and persist it
 * into the victim merchant's manifest.
 *
 * Node.js-only; runs on the VPS backfill host. Single export per the
 * repository modularity boundary.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type BackfillImageCandidate,
  type ClassifiedImage,
  type ProductImages,
  classifyFeedImageCandidate,
  extractImageCandidates,
} from '../../packages/shared/src/gmc-feed/index';
import { toGoogleListingCondition } from '../../packages/shared/src/lib/product-condition';

export interface OfferImageBackfillInput {
  supabase: SupabaseClient;
  productIds: string[];
  merchantId: string;
  storefrontBaseUrl: string;
  productRows: ReadonlyArray<{
    candidate: BackfillImageCandidate;
    classified: ClassifiedImage;
  }>;
  /** Parent product conditions keyed by product ID, for offer eligibility. */
  productConditions: ReadonlyMap<string, string | null | undefined>;
}

const PRODUCT_ID_CHUNK_SIZE = 250;
const OFFER_PAGE_SIZE = 1000;

/**
 * Load active offers for this merchant's products and return their merged,
 * classified image candidates (never primary). Throws on query failure so
 * the caller can fail the backfill loudly instead of silently skipping
 * offer imagery.
 */
export async function appendOfferImageCandidates(
  input: OfferImageBackfillInput
): Promise<
  Array<{ candidate: BackfillImageCandidate; classified: ClassifiedImage }>
> {
  const {
    supabase,
    productIds,
    merchantId,
    storefrontBaseUrl,
    productRows,
    productConditions,
  } = input;
  const offers: Array<{
    id: string;
    product_id: string;
    images: unknown;
    price: number | string | null;
    condition: string | null;
  }> = [];
  for (let start = 0; start < productIds.length; start += PRODUCT_ID_CHUNK_SIZE) {
    let offerOffset = 0;
    let hasMoreOffers = true;
    while (hasMoreOffers) {
      const { data, error: offersError } = await supabase
        .from('product_offers')
        .select('id, product_id, images, price, condition')
        .in('product_id', productIds.slice(start, start + PRODUCT_ID_CHUNK_SIZE))
        .eq('merchant_id', merchantId)
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(offerOffset, offerOffset + OFFER_PAGE_SIZE - 1);

      if (offersError) {
        throw new Error(
          `Failed to fetch product offer images: ${offersError.message}`
        );
      }
      offers.push(...(data ?? []));
      hasMoreOffers = (data?.length ?? 0) === OFFER_PAGE_SIZE;
      offerOffset += OFFER_PAGE_SIZE;
    }
  }

  const seenCandidateKeys = new Set(
    productRows.map(
      ({ candidate }) => `${candidate.product_id}:${candidate.source_url}`
    )
  );
  const offerRows: Array<{
    candidate: BackfillImageCandidate;
    classified: ClassifiedImage;
  }> = [];
  for (const offer of offers) {
    // Mirror the feed eligibility rule: only offers that can emit rows
    // (positive finite price, valid condition, different from the parent
    // condition) contribute manifest entries. Anything else would persist
    // imagery with no exclusion set to guard it.
    const price = Number(offer.price);
    const offerCondition = toGoogleListingCondition(offer.condition);
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !offerCondition ||
      offerCondition ===
        toGoogleListingCondition(
          productConditions.get(offer.product_id)
        )
    ) {
      continue;
    }
    const candidates = extractImageCandidates(
      offer.product_id,
      offer.images as ProductImages
    );
    for (const candidate of candidates) {
      const candidateKey = `${candidate.product_id}:${candidate.source_url}`;
      if (seenCandidateKeys.has(candidateKey)) continue;
      seenCandidateKeys.add(candidateKey);
      offerRows.push({
        candidate: { ...candidate, is_primary: false },
        classified: classifyFeedImageCandidate(
          { ...candidate, is_primary: false },
          storefrontBaseUrl
        ),
      });
    }
  }
  return offerRows;
}
