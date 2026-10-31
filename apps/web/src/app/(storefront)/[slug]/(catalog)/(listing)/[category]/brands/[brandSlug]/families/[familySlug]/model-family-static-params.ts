import { PRERENDER_PLACEHOLDER_STORE_SLUG } from '@/app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/product-static-params';
import { OGABASSEY_DOMAIN, OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { listEligibleAuthorityHubs } from '@/lib/storefront-category/list-eligible-authority-hubs';

export interface ModelFamilyStaticParam {
  slug: string;
  category: string;
  brandSlug: string;
  familySlug: string;
}

/**
 * Prerenders OgaBassey's eligible model-family hubs so their metadata lands in
 * the PPR shell's `<head>` (see brand-authority-static-params.ts). An empty or
 * failed listing falls back to a notFound placeholder.
 */
export async function resolveModelFamilyStaticParams(): Promise<
  ModelFamilyStaticParam[]
> {
  const placeholder = [
    {
      slug: PRERENDER_PLACEHOLDER_STORE_SLUG,
      category: 'smartphones',
      brandSlug: 'apple',
      familySlug: 'iphone-16',
    },
  ];
  try {
    const hubs = await listEligibleAuthorityHubs(OGABASSEY_MERCHANT_ID);
    const params = hubs.flatMap((hub) =>
      hub.familyKeys.map((familyKey) => ({
        slug: OGABASSEY_DOMAIN,
        category: hub.categorySlug,
        brandSlug: hub.brandKey,
        familySlug: familyKey,
      }))
    );
    return params.length > 0 ? params : placeholder;
  } catch {
    return placeholder;
  }
}
