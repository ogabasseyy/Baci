import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedProduct } from './feed-builder';
import { FEED_PRODUCTS_SELECT } from './feed-query';

const FEED_PRODUCTS_PAGE_SIZE = 1000;
// get_feed_product_variants accepts at most 10k product IDs.
const MAX_FEED_PRODUCTS = 10_000;

export interface RawFeedProductRow extends Omit<FeedProduct, 'categories'> {
  categories?:
    | { name?: string; slug?: string }
    | Array<{ name?: string; slug?: string }>
    | null;
  created_at?: string | null;
  product_categories?: Array<{
    categories?: { name?: string; slug?: string } | null;
  }>;
}

interface FeedProductCursor {
  createdAt: string;
  id: string;
}

function getFeedProductCursor(
  page: RawFeedProductRow[]
): FeedProductCursor | null {
  for (let index = page.length - 1; index >= 0; index -= 1) {
    const row = page[index];
    if (row?.created_at) {
      return {
        createdAt: row.created_at,
        id: row.id,
      };
    }
  }

  return null;
}

/**
 * Fetch all active products for a merchant, paginating through dated rows
 * first and then rows with a null created_at.
 */
export async function fetchActiveFeedProducts(
  supabase: SupabaseClient,
  merchantId: string
): Promise<RawFeedProductRow[]> {
  const products: RawFeedProductRow[] = [];
  let cursor: FeedProductCursor | null = null;
  let readNullCreatedAtRows = false;
  let nullCreatedAtCursorId: string | null = null;

  while (true) {
    let query = supabase
      .from('products')
      .select(FEED_PRODUCTS_SELECT)
      .eq('merchant_id', merchantId)
      .eq('status', 'active');

    if (readNullCreatedAtRows) {
      query = query.is('created_at', null);

      if (nullCreatedAtCursorId) {
        query = query.gt('id', nullCreatedAtCursorId);
      }
    } else {
      query = query.not('created_at', 'is', null);
    }

    if (!readNullCreatedAtRows && cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`
      );
    }

    const { data, error } = await (readNullCreatedAtRows
      ? query
          .order('id', { ascending: true })
          .limit(FEED_PRODUCTS_PAGE_SIZE)
          .overrideTypes<RawFeedProductRow[], { merge: false }>()
      : query
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .limit(FEED_PRODUCTS_PAGE_SIZE)
          .overrideTypes<RawFeedProductRow[], { merge: false }>());

    if (error) {
      console.error('DB_PRODUCTS_ERROR:', {
        cursor,
        error,
        merchantId,
        readNullCreatedAtRows,
      });
      throw new Error('Failed to fetch products');
    }

    const page = data || [];
    const remaining = MAX_FEED_PRODUCTS - products.length;
    products.push(...page.slice(0, remaining));

    if (products.length >= MAX_FEED_PRODUCTS) {
      break;
    }

    if (page.length < FEED_PRODUCTS_PAGE_SIZE) {
      if (!readNullCreatedAtRows) {
        readNullCreatedAtRows = true;
        nullCreatedAtCursorId = null;
        continue;
      }
      break;
    }

    if (readNullCreatedAtRows) {
      const lastNullCreatedAtProduct = page.at(-1);
      if (!lastNullCreatedAtProduct?.id) {
        break;
      }

      nullCreatedAtCursorId = lastNullCreatedAtProduct.id;
      continue;
    }

    const nextCursor = getFeedProductCursor(page);
    if (!nextCursor) {
      console.warn('DB_PRODUCTS_CURSOR_WARNING:', { merchantId });
      break;
    }

    cursor = nextCursor;
  }

  return products;
}
