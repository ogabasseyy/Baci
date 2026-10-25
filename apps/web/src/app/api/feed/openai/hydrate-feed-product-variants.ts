import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchFeedVariants } from '../google-merchant/fetch-feed-variants';
import { normalizeFeedVariantPrice } from '../google-merchant/normalize-feed-variant-price';
import { normalizeFeedVariantStringAttributes } from '../google-merchant/normalize-feed-variant-string-attributes';
import type { OpenAIFeedProduct, OpenAIFeedVariant } from './feed-data';

/** Hydrate only the supplied merchant products through the existing public RPC. */
export async function hydrateOpenAIFeedProductVariants(
  supabase: SupabaseClient,
  merchantId: string,
  products: OpenAIFeedProduct[]
): Promise<void> {
  // Public variant RPC carries the same merchant-scoped, selectable projection
  // used by the Google feed. Embedded table joins can omit public variants.
  const variants = await fetchFeedVariants(
    supabase,
    merchantId,
    products.map((product) => product.id)
  );
  const variantsByProduct = new Map<string, OpenAIFeedVariant[]>();
  const allowedProducts = new Set(products.map((product) => product.id));
  for (const row of variants) {
    if (!allowedProducts.has(row.product_id)) continue;
    const list = variantsByProduct.get(row.product_id) ?? [];
    list.push({
      id: row.id,
      attributes: {
        ...(normalizeFeedVariantStringAttributes(row.attributes) ?? {}),
        ...Object.fromEntries(
          Object.entries(row.attributes ?? {})
            .filter(
              ([, value]) => typeof value === 'number' && Number.isFinite(value)
            )
            .map(([key, value]) => [key, String(value)])
        ),
      },
      condition: row.condition ?? undefined,
      price_override:
        normalizeFeedVariantPrice(row.price_override) ?? undefined,
      stock_quantity: row.stock_quantity ?? undefined,
      sku: row.sku ?? undefined,
    });
    variantsByProduct.set(row.product_id, list);
  }
  for (const product of products)
    product.variants = variantsByProduct.get(product.id) ?? [];
}
