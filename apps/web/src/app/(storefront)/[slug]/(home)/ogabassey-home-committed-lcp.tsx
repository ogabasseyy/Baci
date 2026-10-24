import { Suspense } from 'react';
import { OgabasseyHomeCriticalShell } from '@/app/(storefront)/ogabassey/ogabassey-home-critical-shell';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';
import {
  getSettledCanonicalOgabasseyHomeStateBox,
  hydrateSettledCanonicalOgabasseyHomeStateFromParams,
  isStorefrontPageParams,
  markDeferredCommittedLcpToRoute,
  peekSettledCanonicalOgabasseyHomeState,
  recordSettledCanonicalOgabasseyHomeState,
  type SettledCanonicalOgabasseyHomeState,
} from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import {
  isOgabasseyCanonicalDomainSlug,
  isOgabasseyHomeIdentifier,
} from './is-ogabassey-home-identifier';
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
  params: Promise<{ slug: string }>,
  stateBox: SettledCanonicalOgabasseyHomeState
) {
  const { slug } = await params;
  if (isStorefrontPageParams(params) && isOgabasseyCanonicalDomainSlug(slug)) {
    const [resolvedMerchant, heroShell] = await Promise.all([
      Promise.resolve(getRequestScopedMerchant(slug)).catch(() => null),
      Promise.resolve(resolveOgabasseyHomeHeroShell()).catch(() => null),
    ]);
    recordSettledCanonicalOgabasseyHomeState({
      box: stateBox,
      heroShell,
      merchant: resolvedMerchant,
      params,
      shareAcrossRequestTree: true,
      slug,
    });
    markDeferredCommittedLcpToRoute(params);
    return null;
  }
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
  const stateBox = getSettledCanonicalOgabasseyHomeStateBox(params);
  const settled =
    hydrateSettledCanonicalOgabasseyHomeStateFromParams(params) ??
    peekSettledCanonicalOgabasseyHomeState();
  if (settled?.slug) {
    if (
      isStorefrontPageParams(params) &&
      isOgabasseyCanonicalDomainSlug(settled.slug)
    ) {
      markDeferredCommittedLcpToRoute(params);
      return null;
    }
    return renderOgabasseyHomeCommittedLcpForSlug(settled.slug);
  }

  return renderOgabasseyHomeCommittedLcpAsync(params, stateBox);
}
