import { PRERENDER_PLACEHOLDER_STORE_SLUG } from '@/app/(storefront)/[slug]/(catalog)/(pdp)/[category]/[productSlug]/product-static-params';
import { OGABASSEY_DOMAIN, OGABASSEY_MERCHANT_ID } from '@/config/ogabassey';
import { listEligibleAuthorityHubs } from '@/lib/storefront-category/list-eligible-authority-hubs';

export interface BrandAuthorityStaticParam {
  slug: string;
  category: string;
  brandSlug: string;
}

/**
 * Prerenders OgaBassey's eligible brand hubs so each gets a PPR shell with its
 * `<title>`/description resolved into `<head>`. Non-enumerated params render
 * with streamed metadata appended to `<body>` (see product-static-params.ts).
 * cacheComponents requires at least one param, so an empty or failed listing
 * falls back to a placeholder that renders notFound; unlisted hubs still
 * render on demand.
 */
export async function resolveBrandAuthorityStaticParams(): Promise<
  BrandAuthorityStaticParam[]
> {
  const placeholder = [
    {
      slug: PRERENDER_PLACEHOLDER_STORE_SLUG,
      category: 'smartphones',
      brandSlug: 'apple',
    },
  ];
  try {
    const hubs = await listEligibleAuthorityHubs(OGABASSEY_MERCHANT_ID);
    const params = hubs.map((hub) => ({
      slug: OGABASSEY_DOMAIN,
      category: hub.categorySlug,
      brandSlug: hub.brandKey,
    }));
    return params.length > 0 ? params : placeholder;
  } catch {
    return placeholder;
  }
}
