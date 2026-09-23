import {
  BLOG_HERO_IMAGE_QUALITY,
  BLOG_LISTING_FEATURED_IMAGE_PRELOAD_WIDTH,
} from '@/components/storefront/ogabassey/config/blog-media';
import { buildOgabasseyCdnImageLoaderUrl } from '@/lib/ogabassey-cdn-image-url';

/**
 * Byte-identical AVIF URL to the listing featured-story preload (`width=750`,
 * `quality=50`). The snapshot stores the origin asset path; the untransformed
 * public JPEG 404s on CDN, so a raw `<img src>` never paints and LCP waits
 * for the postponed `CdnFormatImage` picture.
 */
export function buildBlogListingLcpHeroSrc(src: string): string {
  return buildOgabasseyCdnImageLoaderUrl(
    src,
    BLOG_LISTING_FEATURED_IMAGE_PRELOAD_WIDTH,
    BLOG_HERO_IMAGE_QUALITY,
    'avif'
  );
}
