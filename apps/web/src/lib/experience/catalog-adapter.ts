import type { PublicCatalog, PublicProduct } from '@baci/shared/experience';
import { isProductVariantPurchasable } from '@baci/shared/lib/is-product-variant-purchasable';
import {
  getEffectiveProductStock,
  getProductStockBucket,
} from '@baci/shared/lib/product-inventory';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublicSerializedVariantSummariesByProductId } from '@/lib/public-serialized-variant-summary';
import { buildStorefrontPdpCanonicalPath } from '@/lib/storefront-pdp-canonical-path';
import { normalizeStorefrontProductVariants } from '@/lib/storefront-product-variants';
import {
  experienceCatalogRowSchema,
  experienceCatalogSelectionSchema,
} from '@/schemas/experience-catalog';
import {
  experienceCatalogRevision,
  readConsistentCatalog,
} from './catalog-revision';
import { assertPublicResponseBudget } from './public-response-budget';
export interface ExperienceCatalogMerchant {
  id: string;
  currency: string;
  is_published: boolean;
}
export function projectExperienceCatalog(
  merchant: ExperienceCatalogMerchant,
  rows: unknown[],
  images: ReadonlyMap<string, { assetId: string; alt: string }> = new Map()
): PublicCatalog {
  const products: PublicProduct[] = [];
  if (merchant.is_published)
    for (const row of rows) {
      const parsed = experienceCatalogRowSchema.safeParse(row);
      if (!parsed.success) throw Error('INVALID_CATALOG');
      const p = parsed.data;
      if (p.merchant_id !== merchant.id || p.status !== 'active') continue;
      const variants = p.product_variants.map((v) => ({
        id: v.id,
        price: v.price_override ?? p.price,
        label:
          Object.values(v.attributes ?? {})
            .filter((x) => typeof x === 'string')
            .join(' / ') || 'Option',
        available: isProductVariantPurchasable(p.manage_stock, {
          ...v,
          is_purchasable: v.is_purchasable ?? undefined,
        }),
      }));
      products.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        price: p.price,
        currency: merchant.currency,
        image: images.get(p.id) ?? null,
        canonicalPath: buildStorefrontPdpCanonicalPath({
          ...p,
          categories:
            p.categories ??
            p.product_categories.find((c) => c.categories?.slug)?.categories ??
            null,
        }),
        available:
          p.has_variants === true || variants.length > 0
            ? variants.some((variant) => variant.available)
            : (p.available ?? getProductStockBucket(p) !== 'out_of_stock'),
        variants,
        requiresVariant:
          p.has_variants === true || p.product_variants.length > 0,
      });
    }
  products.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    products,
    revision: experienceCatalogRevision('projection', products),
  };
}
/** Client must be the normal public/RLS client; merchant was resolved by the host/page. */
export async function loadExperienceCatalog(
  client: SupabaseClient,
  merchant: ExperienceCatalogMerchant,
  selection: unknown,
  images: ReadonlyMap<string, { assetId: string; alt: string }> = new Map()
): Promise<PublicCatalog | null> {
  const input = experienceCatalogSelectionSchema.parse(selection);
  if (!merchant.is_published) return null;
  const generation = async () => {
    const r = await client
      .from('experience_catalog_generations')
      .select('generation')
      .eq('merchant_id', merchant.id)
      .maybeSingle();
    if (r.error) throw Error('CATALOG_UNAVAILABLE');
    return r.data ? String(r.data.generation) : null;
  };
  const result = await readConsistentCatalog({
    generation,
    read: async () => {
      let query = client
        .from('products')
        .select(
          `id,merchant_id,slug,name,price,status,category,categories:category_id(slug,name),canonical_url,has_variants,manage_stock,stock,stock_quantity,images,product_categories${input.categoryId ? '!inner' : ''}(category_id,categories(slug,name))`
        )
        .eq('merchant_id', merchant.id)
        .eq('status', 'active')
        .or('is_parent.eq.true,parent_product_id.is.null')
        .order('id')
        .range(input.offset, input.offset + input.limit - 1);
      if (input.categoryId)
        query = query.eq('product_categories.category_id', input.categoryId);
      if (input.productId) query = query.eq('id', input.productId);
      if (input.productSlug) query = query.eq('slug', input.productSlug);
      const r = await query;
      if (r.error) throw Error('CATALOG_UNAVAILABLE');
      const products = r.data ?? [];
      if (!products.length) return projectExperienceCatalog(merchant, []);
      const ids = products.map((p) => p.id);
      // The public RPC excludes inventory anchors. Anonymous RLS deliberately
      // hides private variant metadata; it must not become a visibility join.
      const [variants, summaries] = await Promise.all([
        client.rpc('get_storefront_product_variants', { p_product_ids: ids }),
        getPublicSerializedVariantSummariesByProductId(
          client,
          merchant.id,
          ids
        ),
      ]);
      if (
        variants.error ||
        !Array.isArray(variants.data) ||
        variants.data.length > 500
      )
        throw Error('CATALOG_UNAVAILABLE');
      return projectExperienceCatalog(
        merchant,
        products.map((p) => ({
          ...p,
          ...(summaries.find(
            (s) => s.productId === p.id && s.variantId === null
          )
            ? {
                available: isProductVariantPurchasable(p.manage_stock, {
                  effective_policy: summaries.find(
                    (s) => s.productId === p.id && s.variantId === null
                  )?.inventoryTrackingPolicy,
                  available_units: summaries.find(
                    (s) => s.productId === p.id && s.variantId === null
                  )?.publicAvailableUnits,
                }),
              }
            : {}),
          product_variants: normalizeStorefrontProductVariants(
            variants.data
              .filter((v: Record<string, unknown>) => v.product_id === p.id)
              .map((v: Record<string, unknown>) => ({
                ...v,
                id: String(v.id),
              })),

            {
              merchantId: merchant.id,
              productId: p.id,
              parentStock: getEffectiveProductStock(p),
            }
          ).map((v) => ({
            id: v.id,
            attributes: v.attributes,
            price_override: v.price_override,
            stock_quantity: v.stock_quantity,
            is_purchasable: isProductVariantPurchasable(p.manage_stock, v),
            effective_policy: v.effective_policy,
            available_units: v.available_units,
          })),
        })),
        images
      );
    },
  });
  if (result)
    assertPublicResponseBudget({
      products: result.data.products,
      revision: result.revision,
    });
  return result
    ? { products: result.data.products, revision: result.revision }
    : null;
}
