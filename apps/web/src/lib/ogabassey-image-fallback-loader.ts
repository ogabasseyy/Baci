import { DEFAULT_IMAGE_QUALITY, DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import imageLoader from '@/lib/image-loader';
import {
  buildOgabasseyCdnFallbackImageLoaderUrl,
  isOgabasseyCdnImageUrl,
} from '@/lib/ogabassey-cdn-image-url';
import { toOgabasseySameOriginTransformUrl } from '@/lib/ogabassey-same-origin-hero-url';

const SAME_ORIGIN_CDN_IMAGE_PREFIX = '/cdn-image/';

/**
 * The shared `next/image` loader for every OgaBassey `<picture>` surface.
 *
 * For OgaBassey CDN images it emits the universally decodable jpeg/png
 * fallback-format transform URL (`buildOgabasseyCdnFallbackImageLoaderUrl`) so
 * the `<img>` tier serves bytes every browser can decode. Callers that want the
 * AVIF tier rewrite this loader's srcSet with `buildOgabasseyAvifSrcSet` /
 * `rewriteOgabasseyTransformUrlFormat`, guaranteeing the two tiers differ ONLY
 * in the format token.
 *
 * Non-CDN sources (Supabase-hosted merchants, local/placeholder assets)
 * delegate to the app's global `imageLoader` unchanged — they have no AVIF twin
 * and render as a plain `<img>`.
 *
 * Extracted from the hero + `getOgabasseyImageFormatProps` surfaces, which each
 * hand-rolled this exact `isOgabasseyCdnImageUrl ? fallback : imageLoader`
 * branch. One definition keeps every migrated surface — and its paired preload
 * hint — on byte-identical URLs (the preload-vs-render parity rule).
 *
 * The CDN branch defaults an absent quality to `DEFAULT_IMAGE_QUALITY`, exactly
 * what the global `imageLoader` clamps `undefined` to, so quality-less card
 * surfaces produce the same width/quality URL through either path.
 *
 * Same-origin `/cdn-image/<options>/<asset>` proxy URLs are re-sized through
 * their CDN twin and mapped back, because the proxy route rejects any query
 * parameter other than `?v=` — appending `?w=&q=` would 400.
 */
export function ogabasseyFallbackImageLoader({
  quality,
  src,
  width,
}: {
  quality?: number;
  src: string;
  width: number;
}): string {
  if (src.startsWith(SAME_ORIGIN_CDN_IMAGE_PREFIX)) {
    return toOgabasseySameOriginTransformUrl(
      buildOgabasseyCdnFallbackImageLoaderUrl(
        `${DEFAULT_MEDIA_CDN_ORIGIN}/image/${src.slice(SAME_ORIGIN_CDN_IMAGE_PREFIX.length)}`,
        width,
        quality ?? DEFAULT_IMAGE_QUALITY
      )
    );
  }

  if (isOgabasseyCdnImageUrl(src)) {
    return buildOgabasseyCdnFallbackImageLoaderUrl(
      src,
      width,
      quality ?? DEFAULT_IMAGE_QUALITY
    );
  }

  return imageLoader({ quality, src, width });
}
