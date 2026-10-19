import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { mediaSubresource } from './storefront-edge-media-subresource-support';

type InventoryRow = StorefrontEdgeInventory['rows'][number];

/** CDN, storage, template, and page-embedded media destinations. */
export const STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS: readonly InventoryRow[] =
  [
    mediaSubresource('media-cdn', 'configured_media_cdn_origin'),
    mediaSubresource('supabase-storage', 'configured_supabase_storage_origin'),
    mediaSubresource(
      'transparent-textures-about',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/ogabassey/pages/about-us.tsx'
    ),
    mediaSubresource(
      'transparent-textures-privacy',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/ogabassey/pages/privacy-policy.tsx'
    ),
    mediaSubresource(
      'transparent-textures-legal',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/ogabassey/pages/legal-dispute.tsx'
    ),
    mediaSubresource(
      'transparent-textures-sustainability-leaf',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/ogabassey/pages/sustainability.tsx'
    ),
    mediaSubresource(
      'transparent-textures-sustainability-wood',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/ogabassey/pages/sustainability.tsx'
    ),
    mediaSubresource(
      'crypto-qr',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/ogabassey/pages/crypto-checkout.tsx'
    ),
    mediaSubresource(
      'product-video-youtube',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/ogabassey/components/ProductVideo.tsx'
    ),
    mediaSubresource(
      'about-page-youtube',
      'configured_external_media_origin',
      'apps/web/src/app/(storefront)/[slug]/(content)/pages/about/about-page-client.tsx'
    ),
    mediaSubresource(
      'about-page-vimeo',
      'configured_external_media_origin',
      'apps/web/src/app/(storefront)/[slug]/(content)/pages/about/about-page-client.tsx'
    ),
    mediaSubresource(
      'gadget-universe-hero',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/templates/gadget-universe.tsx'
    ),
    mediaSubresource(
      'gadget-default-template-hero',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/templates/gadget-default-template.tsx'
    ),
    mediaSubresource(
      'new-template-checkout-mastercard',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/new-template/checkout-page.tsx'
    ),
    mediaSubresource(
      'new-template-footer-noise',
      'configured_external_media_origin',
      'apps/web/src/components/storefront/new-template/footer.tsx'
    ),
    mediaSubresource(
      'blog-content-renderer-external',
      'configured_external_media_origin',
      'apps/web/src/components/blog/renderer/BlogContentRenderer.tsx'
    ),
    mediaSubresource(
      'blog-safe-html-external',
      'configured_external_media_origin',
      'apps/web/src/components/ui/safe-html.tsx'
    ),
  ];
