import { cacheLife, cacheTag } from 'next/cache';
import { projectStandardListingRows } from '@/lib/project-standard-listing-rows';
import { buildStorefrontProductsCacheTags } from '@/lib/storefront-products-cache-key';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  type RawStorefrontProductRow,
  storefrontProductsRouteData,
} from './storefront-products-route-data';

const PRODUCT_ID_FETCH_CHUNK_SIZE = 100;

export async function fetchProductRowsByIds(
  merchantId: string,
  ids: string[],
  options: { compact?: boolean } = {}
) {
  if (ids.length === 0) {
    return [];
  }

  const supabase = createAnonClient();
  const selectColumns: string =
    options.compact === false
      ? storefrontProductsRouteData.STOREFRONT_PRODUCTS_SELECT
      : storefrontProductsRouteData.STOREFRONT_PRODUCTS_COMPACT_SELECT;

  const products: RawStorefrontProductRow[] = [];
  for (
    let index = 0;
    index < ids.length;
    index += PRODUCT_ID_FETCH_CHUNK_SIZE
  ) {
    const idChunk = ids.slice(index, index + PRODUCT_ID_FETCH_CHUNK_SIZE);
    const result = (await supabase
      .from('products')
      .select(selectColumns)
      .eq('merchant_id', merchantId)
      .eq('status', 'active')
      .in('id', idChunk)) as {
      data: RawStorefrontProductRow[] | null;
      error: unknown;
    };

    if (result.error) throw result.error;
    products.push(...(result.data || []));
  }

  return products;
}

export async function fetchProductsByIds(
  merchantId: string,
  ids: string[],
  options: { compact?: boolean } = {}
) {
  'use cache';

  cacheLife('products');
  cacheTag(...buildStorefrontProductsCacheTags(merchantId));

  const products = await fetchProductRowsByIds(merchantId, ids, options);

  return (await projectStandardListingRows(merchantId, products)).map(
    storefrontProductsRouteData.mapProduct
  );
}
