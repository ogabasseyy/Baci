import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

const PUBLIC_ASSETS = [
  'african-santa-head.svg',
  'apple-touch-icon.png',
  'baci-verified-favicon.svg',
  'baci-logo-dark.svg',
  'baci-logo.svg',
  'logo.png',
  'badges/app-store-black.svg',
  'badges/google-play.svg',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'android-chrome-192x192-maskable.png',
  'android-chrome-512x512-maskable.png',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'manifest.json',
  'placeholder.png',
  'placeholder.svg',
  'template-previews/ogabassey-v2.png',
] as const;

/** Exact public files referenced by released storefront browser output. */
export const STOREFRONT_EDGE_PUBLIC_ASSET_ROWS = PUBLIC_ASSETS.map((asset) => ({
  decision: 'edge_release',
  id: `public-asset:${asset}`,
  methods: ['GET', 'HEAD'],
  reason: 'storefront_referenced_public_asset',
  routePattern: `/${asset}`,
  sourceKind: 'public_asset',
  sourcePath: `apps/web/public/${asset}`,
})) satisfies readonly InventoryRow[];

export const STOREFRONT_EDGE_PLATFORM_ROOT_FAVICON_ROW = {
  decision: 'edge_release',
  id: 'public-asset:favicon.ico-platform-root',
  methods: ['GET', 'HEAD'],
  reason: 'platform_root_public_favicon',
  routePattern: '/favicon.ico',
  sourceKind: 'public_asset',
  sourcePath: 'apps/web/public/favicon.ico',
  hostCondition: {
    hostKind: 'platform_root_domain',
    precedence: 'before_path_decision',
  },
} satisfies InventoryRow;
