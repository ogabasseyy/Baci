import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS } from './storefront-edge-redirect-entrypoints';

type Classification = Pick<
  StorefrontEdgeInventory['rows'][number],
  'decision' | 'reason'
>;

const RELEASE_ENTRYPOINTS = [
  '(blog)/blog/[postSlug]/opengraph-image/route.ts',
  '(blog)/blog/[postSlug]/page.tsx',
  '(blog)/blog/author/[authorSlug]/page.tsx',
  '(blog)/blog/category/[categorySlug]/page.tsx',
  '(blog)/blog/page.tsx',
  '(blog)/blog/sitemap.ts',
  '(catalog)/(listing)/[category]/best-under/[priceBandSlug]/page.tsx',
  '(catalog)/(listing)/[category]/brands/[brandSlug]/families/[familySlug]/page.tsx',
  '(catalog)/(listing)/[category]/brands/[brandSlug]/page.tsx',
  '(catalog)/(listing)/[category]/compare/[comparisonSlug]/page.tsx',
  '(catalog)/(listing)/[category]/compare/page.tsx',
  '(catalog)/(listing)/[category]/page.tsx',
  '(catalog)/(listing)/compare/page.tsx',
  '(catalog)/(listing)/products/page.tsx',
  '(catalog)/(pdp)/[category]/[productSlug]/page.tsx',
  '(catalog)/(pdp)/products/[productSlug]/page.tsx',
  '(content)/about/page.tsx',
  '(content)/contact/page.tsx',
  '(content)/faq/page.tsx',
  '(content)/privacy/page.tsx',
  '(content)/returns/page.tsx',
  '(content)/shipping/page.tsx',
  '(content)/terms/page.tsx',
  '(content)/warranty/page.tsx',
  '(home)/page.tsx',
  'opengraph-image.tsx',
] as const;

const DYNAMIC_ENTRYPOINTS = [
  '(blog)/blog/[...catchAll]/route.ts',
  '(blog)/blog/news-sitemap.xml/route.ts',
  'sitemap/[id]/route.ts',
  '(catalog)/(listing)/[category]/graphics/[graphicsSlug]/page.tsx',
  '(catalog)/(listing)/search/page.tsx',
  '(catalog)/(pdp)/product/[productSlug]/page.tsx',
  '(commerce)/cart/page.tsx',
  '(commerce)/checkout/bnpl/page.tsx',
  '(commerce)/checkout/crypto/page.tsx',
  '(commerce)/checkout/page.tsx',
  '(commerce)/checkout/success/page.tsx',
  '(commerce)/order-success/page.tsx',
  '(commerce)/track-order/page.tsx',
  '(commerce)/wallet/page.tsx',
  '(commerce)/wishlist/page.tsx',
  '(content)/pages/rewards/page.tsx',
  '(customer)/account/addresses/page.tsx',
  '(customer)/account/callback/route.ts',
  '(customer)/account/login/page.tsx',
  '(customer)/account/orders/[orderId]/insurance/page.tsx',
  '(customer)/account/orders/[orderId]/page.tsx',
  '(customer)/account/orders/page.tsx',
  '(customer)/account/page.tsx',
  '(customer)/account/settings/page.tsx',
  '(customer)/delete-account/page.tsx',
  '(customer)/my-account/[...path]/page.tsx',
  '(customer)/my-account/page.tsx',
  '(customer)/receipts/claim/[token]/page.tsx',
  '(customer)/receipts/page.tsx',
  'storefront/[legacySlug]/swap/route.ts',
  '(utility)/imei-check/page.tsx',
  '(utility)/member-status/page.tsx',
  '(utility)/quiz/page.tsx',
  '(utility)/repair/page.tsx',
  '(utility)/repair/status/page.tsx',
  '(utility)/repairs/[deviceSlug]/page.tsx',
  '(utility)/repairs/page.tsx',
  '(utility)/reviews/page.tsx',
  '(utility)/swap/page.tsx',
  '(utility)/unlock-orders/page.tsx',
] as const;

function dynamicEntrypointReason(
  sourcePath: (typeof DYNAMIC_ENTRYPOINTS)[number]
) {
  if (sourcePath === '(blog)/blog/[...catchAll]/route.ts') {
    return 'dynamic_redirect_or_bounded_not_found' as const;
  }
  if (sourcePath === '(blog)/blog/news-sitemap.xml/route.ts') {
    return 'rolling_news_sitemap_requires_origin' as const;
  }
  if (sourcePath === 'sitemap/[id]/route.ts') {
    return 'finite_sitemap_id_dispatch_requires_origin' as const;
  }
  return 'request_state_or_origin_action_required' as const;
}

const rows: readonly (readonly [string, Classification])[] = [
  ...RELEASE_ENTRYPOINTS.map(
    (sourcePath) =>
      [
        sourcePath,
        { decision: 'edge_release', reason: 'public_release_surface' },
      ] as const
  ),
  ...DYNAMIC_ENTRYPOINTS.map(
    (sourcePath) =>
      [
        sourcePath,
        {
          decision: 'origin_dynamic',
          reason: dynamicEntrypointReason(sourcePath),
        },
      ] as const
  ),
  ...STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS.map(
    (sourcePath) =>
      [
        sourcePath,
        {
          decision: 'edge_redirect',
          reason: 'redirect_only_storefront_entrypoint',
        },
      ] as const
  ),
];

if (new Set(rows.map(([sourcePath]) => sourcePath)).size !== rows.length)
  throw new Error('storefront entrypoint classifications contain duplicates');

/** Exhaustive reviewed classification for every current storefront entrypoint. */
export const STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS = new Map(rows);
