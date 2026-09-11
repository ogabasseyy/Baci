import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedOffer } from './feed-types';

interface FeedOfferRow {
  condition: FeedOffer['condition'];
  id: string;
  images?: unknown;
  price: number | string;
  product_id: string;
  stock_quantity: number | null;
}

// Keep PostgREST in(...) filters under common proxy limits.
const BATCH_SIZE = 250;

export async function fetchActiveFeedOffers(
  supabase: SupabaseClient,
  productIds: string[]
): Promise<FeedOfferRow[]> {
  const rows: FeedOfferRow[] = [];
  for (let start = 0; start < productIds.length; start += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('product_offers')
      .select('id, product_id, condition, price, stock_quantity, images')
      .in('product_id', productIds.slice(start, start + BATCH_SIZE))
      .eq('status', 'active');
    if (error) throw new Error('Failed to fetch product offers');
    rows.push(...((data || []) as FeedOfferRow[]));
  }
  return rows;
}
