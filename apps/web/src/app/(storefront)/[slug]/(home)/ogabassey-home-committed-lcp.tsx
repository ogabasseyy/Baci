import { Suspense } from 'react';
import { OgabasseyHomeCriticalShell } from '@/app/(storefront)/ogabassey/ogabassey-home-critical-shell';
import {
  hydrateSettledCanonicalOgabasseyHomeStateFromParams,
  peekSettledCanonicalOgabasseyHomeState,
} from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';
import { OgabasseyHomeCommittedSlideZeroPreload } from './ogabassey-home-committed-slide-zero-preload';

function renderOgabasseyHomeCommittedLcpForSlug(slug: string) {
  if (!isOgabasseyHomeIdentifier(slug)) {
    return null;
  }

  const settledHeroShell =
    peekSettledCanonicalOgabasseyHomeState()?.heroShellSettled === true;

  return (
    <>
      <div data-ogabassey-home-lcp-shell="true">
        <OgabasseyHomeCriticalShell />
      </div>
      {settledHeroShell ? (
        <OgabasseyHomeCommittedSlideZeroPreload />
      ) : (
        <Suspense fallback={null}>
          <OgabasseyHomeCommittedSlideZeroPreload />
        </Suspense>
      )}
    </>
  );
}

async function renderOgabasseyHomeCommittedLcpAsync(
  params: Promise<{ slug: string }>
) {
  const { slug } = await params;
  return renderOgabasseyHomeCommittedLcpForSlug(slug);
}

/**
 * Early critical styles and accessible document heading, without a second
 * visible banner. The request-scoped publication owner renders the real hero.
 *
 * This slot awaits `params` only when not already settled for the current
 * request, so it streams in the first flush even when backend reads run slow;
 * the slide-0 preload resolves beneath its own Suspense boundary from the same
 * live slide data the hero renders.
 */
export function OgabasseyHomeCommittedLcp({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const settled = hydrateSettledCanonicalOgabasseyHomeStateFromParams(params);
  if (settled?.slug) {
    return renderOgabasseyHomeCommittedLcpForSlug(settled.slug);
  }

  return renderOgabasseyHomeCommittedLcpAsync(params);
}
