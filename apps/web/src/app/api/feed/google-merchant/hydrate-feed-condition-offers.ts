import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedOffer, FeedProduct } from './feed-builder';
import { fetchActiveFeedOffers } from './fetch-active-feed-offers';

/**
 * Attach condition offers to legacy products that still use them, mapping
 * rows onto the feed offer contract. Mutates the given products in place.
 */
export async function attachConditionOffers(
  supabase: SupabaseClient,
  feedProducts: FeedProduct[]
): Promise<void> {
  // Fetch condition offers for legacy products that still use them
  const productsWithOffers = feedProducts.filter(
    (p) => p.variant_model !== 'sku_matrix' && p.has_condition_offers
  );

  if (productsWithOffers.length > 0) {
    const offerProductIds = productsWithOffers.map((p) => p.id);
    const offerRows = await fetchActiveFeedOffers(supabase, offerProductIds);

    if (offerRows.length > 0) {
      const offersByProduct = new Map<string, FeedOffer[]>();
      for (const row of offerRows) {
        const pid = row.product_id as string;
        if (!offersByProduct.has(pid)) {
          offersByProduct.set(pid, []);
        }
        offersByProduct.get(pid)?.push({
          images: row.images,
          id: row.id as string,
          condition: row.condition as FeedOffer['condition'],
          compare_at_price:
            row.compare_at_price == null ? null : Number(row.compare_at_price),
          price: Number(row.price),
          stock_quantity: row.stock_quantity as number,
        });
      }
      for (const product of feedProducts) {
        product.offers = offersByProduct.get(product.id);
      }
    }
  }
}
