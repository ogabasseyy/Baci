type StorefrontEdgeDecision =
  | 'edge_redirect'
  | 'edge_release'
  | 'edge_terminal'
  | 'origin_dynamic';

type StorefrontEdgeMethod =
  | 'ANY'
  | 'DELETE'
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'OTHER'
  | 'PATCH'
  | 'POST'
  | 'PUT';

type StorefrontEdgeInventoryRow = Readonly<{
  decision: StorefrontEdgeDecision;
  destinationCondition?: Readonly<{
    hostKind:
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
      | 'configured_supabase_origin'
      | 'configured_supabase_storage_origin';
    precedence: 'before_path_decision';
  }>;
  hostCondition?:
    | Readonly<{
        hostKind: 'platform_subdomain';
        hostnameIn?: readonly string[];
        precedence: 'before_path_decision';
        requiresActiveCanonicalCustomDomain?: true;
      }>
    | Readonly<{
        hostKind: 'custom_domain';
        hostnameIn?: readonly string[];
        precedence: 'before_path_decision';
      }>
    | Readonly<{
        hostKind: 'retired_platform_subdomain_alias';
        precedence: 'before_path_decision';
      }>
    | Readonly<{
        hostKind: 'platform_root_domain';
        hostnameIn?: readonly string[];
        precedence: 'before_path_decision';
        requiresActiveCanonicalCustomDomain?: true;
      }>;
  id: string;
  methods: readonly StorefrontEdgeMethod[];
  reason: string;
  requestCondition?: Readonly<{
    anyCookiePresent?: readonly string[];
    anyCookieNameContains?: readonly string[];
    cookiePredicate?: 'supabase_auth_session_hint';
    anyOf?: readonly Readonly<{
      cookiePredicate?: 'supabase_auth_session_hint';
      anyHeaderMatch?: readonly Readonly<{ name: string; value?: string }>[];
    }>[];
    anyHeaderMatch?: readonly Readonly<{ name: string; value?: string }>[];
    anyQueryPresent?: true;
    anyQueryPresentExcept?: readonly string[];
    anyQueryKeyPresent?: readonly string[];
    matchedStorefrontEntrypointDecision?: 'edge_release';
    matchedStorefrontEntrypointId?: string;
    pathMembership?: 'current_origin_next_build_manifest';
    precedence:
      | 'after_entrypoint_resolution_before_decision'
      | 'before_path_decision';
  }>;
  pathCondition?: Readonly<{
    firstSegmentIn?: readonly string[];
    firstSegmentNotIn?: readonly string[];
    precedence: 'before_path_decision';
    predicate:
      | 'cache_safe_imported_punctuation'
      | 'current_storefront_slug_api'
      | 'legacy_analytics_conversion'
      | 'first_segment_allowlist'
      | 'legacy_blog_thumbnail_query'
      | 'legacy_blog_category_permalink'
      | 'legacy_blog_wordpress_probe'
      | 'legacy_blog_spam_prefix'
      | 'blog_post_status_redirect'
      | 'blog_post_status_missing'
      | 'blog_listing_status_redirect'
      | 'blog_listing_status_missing'
      | 'missing_product_hard_404'
      | 'empty_compare_hub_hard_404'
      | 'canonical_custom_domain_redirect_non_api'
      | 'current_storefront_custom_domain_redirect'
      | 'api_prefix_passthrough'
      | 'legacy_klump_webhook_normalized'
      | 'markdown_negotiation_storefront_excluding_machine'
      | 'mixed_case_path'
      | 'noncanonical_product_route_or_variant'
      | 'retired_alias_storefront_path'
      | 'redundant_storefront_slug_prefix'
      | 'retired_storefront_slug_prefix'
      | 'trailing_slash'
      | 'trailing_slash_excluding_well_known'
      | 'unsafe_or_ambiguous_path';
  }>;
  routePattern: string;
  sourceKind:
    | 'api_family'
    | 'api_route'
    | 'automatic_subresource'
    | 'machine_family'
    | 'proxy_path_class'
    | 'public_asset'
    | 'request_override'
    | 'server_action'
    | 'storefront_entrypoint';
  sourcePath?: string;
}>;

/** Deterministic Task 1A input sealed by the later Task 0A cost gate. */
export type StorefrontEdgeInventory = Readonly<{
  authority: 'directional_cost_screen_only';
  completeBrowserPathClasses: readonly string[];
  eligibleDenominatorPolicy: Readonly<{
    decisions: readonly StorefrontEdgeDecision[];
    methods: readonly StorefrontEdgeMethod[];
    scope: string;
    zeroDenominatorVerdict: 'NOT_PROVEN';
  }>;
  inventorySha256: string;
  originMainSha: string;
  pilotCandidateHostnameSha256: string;
  pilotCandidateHostnames: readonly string[];
  routeTreeSha256: string;
  routingProxyInputSha256: string;
  rows: readonly StorefrontEdgeInventoryRow[];
  schemaVersion: 6;
}>;
