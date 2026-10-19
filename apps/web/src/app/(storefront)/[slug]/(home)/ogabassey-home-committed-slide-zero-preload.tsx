import { OgabasseyHomeHeroPreloadLink } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-preload-link';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';

/**
 * Slide-0 preload resolved beneath its own boundary, so the shell lookup
 * (budget-capped, but still a wait of up to 500ms on a cold/missing cache)
 * never delays the critical shell and heading above.
 *
 * Preloads the live slide-0 only. A lookup miss, an unpublished merchant,
 * or an empty slide deck renders no guessed-image hint: a hardcoded
 * fallback would rot on every merchandising rotation and download an
 * unused image, while the recovery path renders from actual product data.
 * Do not read request APIs here; the URL is inert hint bytes, never UI.
 */
export async function OgabasseyHomeCommittedSlideZeroPreload() {
  const heroShell = await resolveOgabasseyHomeHeroShell();
  const slideZeroUrl =
    heroShell?.status === 'published'
      ? heroShell.slides[0]?.imageUrl
      : undefined;
  if (!slideZeroUrl) {
    return null;
  }
  return <OgabasseyHomeHeroPreloadLink src={slideZeroUrl} />;
}
