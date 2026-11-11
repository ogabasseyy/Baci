import { cache } from 'react';
import type { CachedMerchant } from '@/lib/cached-data';
import type { Product } from '@/lib/products';
import { loadPublishedExperience } from './published-manifest';
import { getExperienceStorefrontRuntime } from './storefront-runtime';
/** Only opted-in public route reads become uncached; all metadata/body readers share this result. */
export const loadFreshExperienceProduct = cache(
  async (
    merchant: CachedMerchant,
    slug: string
  ): Promise<
    | { active: false }
    | { active: true; merchant: CachedMerchant; product: Product | null }
  > => {
    const runtime = getExperienceStorefrontRuntime();
    if (!runtime) return { active: false };
    const head = await loadPublishedExperience(merchant);
    if (!head?.routes.some((route) => route.view === 'product'))
      return { active: false };
    const catalog = await runtime.catalog(merchant, { productSlug: slug });
    if (!catalog) throw Error('CURRENT_CATALOG_UNAVAILABLE');
    const p = catalog.products.find((p) => p.slug === slug);
    if (!p) return { active: true, merchant, product: null };
    const category = p.canonicalPath?.split('/')[1];
    const product: Product = {
      id: p.id,
      merchant_id: merchant.id,
      name: p.name,
      slug: p.slug,
      description: p.name,
      status: 'active',
      price: p.price,
      manage_stock: true,
      stock: p.available === false ? 0 : 1,
      stock_quantity: p.available === false ? 0 : 1,
      has_variants: p.requiresVariant ?? false,
      image: '/placeholder.png',
      imageLarge: '/placeholder.png',
      imageHint: p.name,
      brand: '',
      gtin: '',
      mpn: '',
      canonical_url: p.canonicalPath,
      category_slug: category,
      categories: category ? { slug: category, name: category } : null,
      variants: p.variants.map((v) => ({
        id: v.id,
        product_id: p.id,
        merchant_id: merchant.id,
        attributes: { option: v.label },
        stock_quantity: v.available ? 1 : 0,
        price_override: v.price ?? p.price,
      })),
    };
    return {
      active: true,
      merchant: { ...merchant, payout_currency: p.currency },
      product,
    };
  }
);
