import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { createStorefrontEdgeProxyClass } from './storefront-edge-proxy-class';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const REDIRECTS = [
  ['next:user-legacy', '/user/{*path?}'],
  ['next:home-legacy', '/home/{*path?}'],
  ['next:blog-iphone-xr', '/blog/iphone-xr-in-2025-is-this-still-a-good-deal'],
  [
    'next:blog-samsung-s21',
    '/blog/why-the-samsung-galaxy-s21-ultra-is-still-a-top-pick-in-2024',
  ],
  [
    'next:blog-wwdc',
    '/blog/wwdc-2025-5-game%e2%80%91changing-apple-announcements/{*path?}',
  ],
  [
    'next:blog-wwdc-date',
    '/blog/2025/06/10/wwdc-2025-5-game%e2%80%91changing-apple-announcements/{*path?}',
  ],
  [
    'next:blog-wwdc-prefix',
    '/blog/wwdc%e2%80%912025%e2%80%915-game-changing-apple-announcements/{*path?}',
  ],
  [
    'next:blog-wwdc-double-encoded',
    '/blog/wwdc%25e2%2580%25912025%25e2%2580%25915-game-changing-apple-announcements/{*path?}',
  ],
  [
    'next:blog-off-topic-malami',
    '/blog/abubakar-malami-remanded-former-nigerian-agf-faces-multi-billion-naira-property-charges',
  ],
  [
    'next:blog-off-topic-reserves',
    '/blog/cbn-forecast-nigerias-external-reserves-projected-to-hit-5104-billion-by-2026',
  ],
  ['next:iphone-nfid', '/phones/iphone-x-3gb-64gb-nfid'],
  ['next:macbook', '/macbook/{*path?}'],
  ['next:samsung', '/samsung/{*path?}'],
  ['next:phones', '/phones/{*path?}'],
  ['next:oppo', '/oppo/{*path?}'],
  [
    'next:product-category-accessories',
    '/product-category/accessories/{*path?}',
  ],
  ['next:product-category-headphones', '/product-category/headphones/{*path?}'],
  [
    'next:product-category-smartwatches',
    '/product-category/smartwatches/{*path?}',
  ],
  ['next:product-category', '/product-category/{*path?}'],
  ['next:category-product', '/category/product/{id}'],
  ['next:slug-pages-terms', '/{slug}/pages/terms'],
  ['next:slug-pages-privacy', '/{slug}/pages/privacy'],
  ['next:slug-pages-about', '/{slug}/pages/about'],
  ['next:slug-pages-faq', '/{slug}/pages/faq'],
  ['next:slug-pages-contact', '/{slug}/pages/contact'],
  ['next:slug-terms-of-service', '/{slug}/terms-of-service'],
  ['next:slug-privacy-policy', '/{slug}/privacy-policy'],
] as const;

const OGABASSEY_APEX_ONLY_HOSTS = ['ogabassey.com'] as const;
const OGABASSEY_APEX_ONLY_REDIRECT_IDS = new Set([
  'next:macbook',
  'next:samsung',
  'next:phones',
  'next:oppo',
]);
const OGABASSEY_APEX_AND_WWW_HOSTS = [
  'ogabassey.com',
  'www.ogabassey.com',
] as const;
const OGABASSEY_APEX_AND_WWW_REDIRECT_IDS = new Set([
  'next:product-category-accessories',
  'next:product-category-headphones',
  'next:product-category-smartwatches',
  'next:product-category',
  'next:category-product',
  'next:blog-off-topic-malami',
  'next:blog-off-topic-reserves',
]);

/** Reviewed redirect surfaces declared by apps/web/next.config.ts. */
export const STOREFRONT_EDGE_NEXT_REDIRECT_ROWS: readonly InventoryRow[] =
  REDIRECTS.map(([id, routePattern]) => {
    const hostnameIn = OGABASSEY_APEX_ONLY_REDIRECT_IDS.has(id)
      ? OGABASSEY_APEX_ONLY_HOSTS
      : OGABASSEY_APEX_AND_WWW_REDIRECT_IDS.has(id)
        ? OGABASSEY_APEX_AND_WWW_HOSTS
        : undefined;
    return createStorefrontEdgeProxyClass(
      id,
      routePattern,
      ['ANY'],
      'edge_redirect',
      'next_config_redirect',
      hostnameIn
        ? {
            hostCondition: {
              hostKind: 'custom_domain',
              hostnameIn,
              precedence: 'before_path_decision',
            },
          }
        : {}
    );
  });
