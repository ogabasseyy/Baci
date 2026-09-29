import { Suspense } from 'react';
import { OgabasseyHomeCriticalShell } from '@/app/(storefront)/ogabassey/ogabassey-home-critical-shell';
import { OgabasseyHomeHeroPreloadLink } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-preload-link';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';

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
async function CommittedSlideZeroPreload() {
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

/**
 * Early critical styles and accessible document heading, without a second
 * visible banner. The request-scoped publication owner renders the real hero.
 *
 * This slot awaits `params` only, so it streams in the first flush even
 * when backend reads run slow; the slide-0 preload resolves beneath its
 * own Suspense boundary from the same live slide data the hero renders.
 */
export async function OgabasseyHomeCommittedLcp({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isOgabasseyHomeIdentifier(slug)) {
    return null;
  }

  return (
    <>
      <div data-ogabassey-home-lcp-shell="true">
        <OgabasseyHomeCriticalShell />
      </div>
      <Suspense fallback={null}>
        <CommittedSlideZeroPreload />
      </Suspense>
    </>
  );
}
