import { Suspense } from 'react';
import { OgabasseyHomeCriticalShell } from '@/app/(storefront)/ogabassey/ogabassey-home-critical-shell';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';
import { OgabasseyHomeCommittedSlideZeroPreload } from './ogabassey-home-committed-slide-zero-preload';

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
        <OgabasseyHomeCommittedSlideZeroPreload />
      </Suspense>
    </>
  );
}
