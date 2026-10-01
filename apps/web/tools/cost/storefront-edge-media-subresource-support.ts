import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

export type MediaDestinationHostKind =
  | 'configured_media_cdn_origin'
  | 'configured_external_media_origin'
  | 'configured_google_tag_manager_origin'
  | 'configured_google_analytics_collection_origin'
  | 'configured_google_ad_manager_origin'
  | 'configured_google_store_widget_origin'
  | 'configured_google_store_badge_origin'
  | 'configured_google_customer_reviews_origin'
  | 'configured_supabase_storage_upload_origin'
  | 'configured_klump_origin'
  | 'configured_korapay_origin'
  | 'configured_paystack_asset_origin'
  | 'configured_paystack_checkout_origin'
  | 'configured_juicyway_origin'
  | 'configured_credpal_origin'
  | 'configured_credit_direct_origin'
  | 'configured_meta_origin'
  | 'configured_tiktok_origin'
  | 'configured_snapchat_origin'
  | 'configured_twitter_origin'
  | 'configured_whatsapp_origin'
  | 'configured_google_maps_origin'
  | 'configured_mycover_flow_origin'
  | 'configured_mycover_certificate_origin'
  | 'configured_carrier_tracking_origin'
  | 'configured_merchant_social_origin'
  | 'configured_app_store_origin'
  | 'configured_play_store_origin'
  | 'configured_supabase_storage_origin';

export const mediaSubresource = (
  id: string,
  hostKind: MediaDestinationHostKind,
  sourcePath = 'apps/web/src/components/storefront/cdn-format-image.tsx',
  methods: readonly InventoryRow['methods'][number][] = ['GET', 'HEAD']
): InventoryRow => ({
  decision: 'origin_dynamic',
  destinationCondition: {
    hostKind,
    precedence: 'before_path_decision',
  },
  id: `automatic-subresource:${id}`,
  methods,
  reason: 'browser_external_media_request',
  routePattern: '/{*externalMediaPath?}',
  sourceKind: 'automatic_subresource',
  sourcePath,
});
