import 'server-only';
import { preconnect, prefetchDNS, preload } from 'react-dom';
import { OGABASSEY_CDN_ORIGIN } from '@/components/storefront/ogabassey/config/storefront-origins';
import { isOgabasseyCdnImageUrl } from '@/lib/ogabassey-cdn-image-url';
import { ogabasseyHomeHeroResourceHintProjection } from '@/lib/ogabassey-home-hero-resource-hint-projection';

/**
 * Early resource hints for the home hero's slide-0 LCP image.
 *
 * Mirrors `blog-post-hero-resource-hints.ts`: a `preload()` whose
 * `imageSrcSet`/`imageSizes`/`quality` match `MobileLcpHeroImage`'s rendered
 * `<picture>` exactly, so browser preload-matching dedupes them into one
 * responsive fetch. The hint is what kills the measured ~6s LCP loadDelay —
 * without it the hero URL is only discoverable after the dynamic subtree
 * streams and hydrates.
 *
 * The hint targets the AVIF tier the picture renders for AVIF-capable browsers
 * (the ~93% majority): Cloudflare Free ignores `Vary: Accept`, so the picture
 * ships explicit per-format `<source>`s instead of one `format=auto` body, and
 * the preload must match the `image/avif` source or it fetches bytes the
 * browser never paints. Non-AVIF browsers skip a preload whose `type` they
 * cannot decode and discover the fallback `<source>` inline in the shell.
 *
 * Media-scoped to the mobile source (the field LCP problem is mobile;
 * desktop's grid streams its own images), and emitted via react-dom
 * `preload()` — NEVER as rendered `<link>` nodes, which cause PPR resume
 * drift when they precede the first critical-shell host node (see the note
 * in `ogabassey-pdp-product-resource-hints.ts`).
 */
export function preloadOgabasseyHomeHeroResources(
  src: string | null | undefined
): void {
  try {
    const candidate = src?.trim();
    if (!candidate || !isOgabasseyCdnImageUrl(candidate)) {
      return;
    }
    // Preserve the origin hints even if a later image transform fails. The
    // hints are safe for a canonical CDN candidate; only the image preload
    // depends on the projection completing successfully.
    prefetchDNS(OGABASSEY_CDN_ORIGIN);
    preconnect(OGABASSEY_CDN_ORIGIN);

    const projection = ogabasseyHomeHeroResourceHintProjection.build(src);
    if (!projection) {
      console.error('Failed to emit home hero preload hints', {
        error: new Error('Unable to build hero preload projection'),
      });
      return;
    }

    preload(projection.href, {
      as: projection.as,
      fetchPriority: projection.fetchPriority,
      imageSizes: projection.imageSizes,
      imageSrcSet: projection.imageSrcSet,
      media: projection.media,
      type: projection.type,
    });
  } catch (error) {
    // Fail-open: an optimization hint must never break the shell render.
    console.error('Failed to emit home hero preload hints', { error });
  }
}
