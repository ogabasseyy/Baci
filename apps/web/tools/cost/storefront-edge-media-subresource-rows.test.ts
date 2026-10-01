import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ROWS } from './storefront-edge-media-subresource-rows';

describe('external storefront media inventory', () => {
  it('keeps CDN and storage image requests destination-aware', () => {
    const summaries = STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ROWS.map(
      ({ destinationCondition, decision, methods }) => ({
        decision,
        hostKind: destinationCondition?.hostKind,
        methods,
      })
    );

    expect(summaries.every((s) => s.decision === 'origin_dynamic')).toBe(true);

    const hostCounts = new Map<string | undefined, number>();
    for (const s of summaries) {
      hostCounts.set(s.hostKind, (hostCounts.get(s.hostKind) ?? 0) + 1);
    }

    expect(hostCounts.get('configured_media_cdn_origin')).toBe(1);
    expect(hostCounts.get('configured_supabase_storage_origin')).toBe(1);
    expect(hostCounts.get('configured_supabase_storage_upload_origin')).toBe(1);
    expect(hostCounts.get('configured_google_tag_manager_origin')).toBe(1);
    expect(
      hostCounts.get('configured_google_analytics_collection_origin')
    ).toBe(1);
    expect(hostCounts.get('configured_carrier_tracking_origin')).toBe(1);
    expect(hostCounts.get('configured_klump_origin')).toBe(1);
    expect(hostCounts.get('configured_whatsapp_origin')).toBe(1);
    expect(hostCounts.get('configured_merchant_social_origin')).toBe(1);
    expect(
      hostCounts.get('configured_app_store_origin') ?? 0
    ).toBeGreaterThanOrEqual(2);
    expect(
      hostCounts.get('configured_play_store_origin') ?? 0
    ).toBeGreaterThanOrEqual(2);
    expect(
      hostCounts.get('configured_google_maps_origin') ?? 0
    ).toBeGreaterThanOrEqual(4);
    expect(
      hostCounts.get('configured_external_media_origin') ?? 0
    ).toBeGreaterThanOrEqual(10);

    const postRow = summaries.find(
      (s) => s.hostKind === 'configured_google_analytics_collection_origin'
    );
    expect(postRow?.methods).toEqual(['GET', 'HEAD', 'POST']);

    const uploadRow = summaries.find(
      (s) => s.hostKind === 'configured_supabase_storage_upload_origin'
    );
    expect(uploadRow?.methods).toEqual(['PUT', 'OPTIONS']);
  });

  it('binds checkout payment logos and legal texture pages to reviewed sources', () => {
    const byId = new Map(
      STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ROWS.map((row) => [row.id, row])
    );

    expect(byId.get('automatic-subresource:checkout-payment-paystack')).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/components/PaymentLogos.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_paystack_asset_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:transparent-textures-privacy')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/pages/privacy-policy.tsx',
      })
    );
    expect(
      byId.get('automatic-subresource:transparent-textures-sustainability-leaf')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/pages/sustainability.tsx',
      })
    );
    expect(
      byId.get('automatic-subresource:google-analytics-collection')
    ).toEqual(
      expect.objectContaining({
        methods: ['GET', 'HEAD', 'POST'],
        sourcePath: 'apps/web/src/components/analytics/google-analytics.tsx',
      })
    );
    expect(
      byId.get('automatic-subresource:new-template-checkout-mastercard')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/new-template/checkout-page.tsx',
      })
    );
    expect(
      byId.get('automatic-subresource:negotiation-evidence-upload')
    ).toEqual(
      expect.objectContaining({
        methods: ['PUT', 'OPTIONS'],
      })
    );
    expect(
      byId.get('automatic-subresource:utility-checkout-paystack-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/components/utility-checkout.ts',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_paystack_checkout_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:device-swap-whatsapp-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/pages/swap.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_whatsapp_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:footer-google-maps-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/components/Footer.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_google_maps_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:help-google-maps-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/pages/help-support.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_google_maps_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:blog-share-twitter-blog-post-body')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/blog-post-body.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_twitter_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:blog-share-meta-blog-post-body-alt')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/app/(storefront)/[slug]/(blog)/blog/[postSlug]/BlogPostBody.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_meta_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:footer-merchant-social-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/components/Footer.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_merchant_social_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:footer-app-store-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/components/FooterAppPayments.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_app_store_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:footer-play-store-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/components/FooterAppPayments.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_play_store_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:receipt-claim-app-store-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/pages/receipt-claim-app-download-banner.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_app_store_origin',
        }),
      })
    );
    expect(
      byId.get('automatic-subresource:receipt-claim-play-store-navigation')
    ).toEqual(
      expect.objectContaining({
        sourcePath:
          'apps/web/src/components/storefront/ogabassey/pages/receipt-claim-app-download-banner.tsx',
        destinationCondition: expect.objectContaining({
          hostKind: 'configured_play_store_origin',
        }),
      })
    );
  });
});
