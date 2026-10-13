import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { mediaSubresource } from './storefront-edge-media-subresource-support';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

/** Analytics pixels, widgets, and evidence uploads. */
export const STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS: readonly InventoryRow[] =
  [
    mediaSubresource(
      'google-tag-manager',
      'configured_google_tag_manager_origin',
      'apps/web/src/components/analytics/analytics-pixel-provider.tsx'
    ),
    mediaSubresource(
      'google-analytics-collection',
      'configured_google_analytics_collection_origin',
      'apps/web/src/components/analytics/google-analytics.tsx',
      ['GET', 'HEAD', 'POST']
    ),
    mediaSubresource(
      'google-ad-manager',
      'configured_google_ad_manager_origin',
      'apps/web/src/components/storefront/ogabassey/components/google-ad-bootstrap.ts'
    ),
    mediaSubresource(
      'google-store-widget',
      'configured_google_store_widget_origin',
      'apps/web/src/components/analytics/google-store-widget.tsx'
    ),
    mediaSubresource(
      'google-store-badge',
      'configured_google_store_badge_origin',
      'apps/web/src/components/analytics/google-store-widget.tsx'
    ),
    mediaSubresource(
      'google-customer-reviews',
      'configured_google_customer_reviews_origin',
      'apps/web/src/components/analytics/google-customer-reviews.tsx'
    ),
    mediaSubresource(
      'negotiation-evidence-upload',
      'configured_supabase_storage_upload_origin',
      'apps/web/src/components/storefront/ogabassey/components/negotiation-evidence.ts',
      ['PUT', 'OPTIONS']
    ),
    mediaSubresource(
      'meta',
      'configured_meta_origin',
      'apps/web/src/components/analytics/facebook-pixel.tsx'
    ),
    mediaSubresource(
      'tiktok',
      'configured_tiktok_origin',
      'apps/web/src/components/analytics/analytics-pixel-provider.tsx'
    ),
    mediaSubresource(
      'snapchat',
      'configured_snapchat_origin',
      'apps/web/src/components/analytics/snapchat-pixel.tsx'
    ),
    mediaSubresource(
      'twitter',
      'configured_twitter_origin',
      'apps/web/src/components/analytics/twitter-pixel.tsx'
    ),
  ];
