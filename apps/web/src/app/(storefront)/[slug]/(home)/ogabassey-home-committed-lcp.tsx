import { OgabasseyPublicationSafeHeroFallback } from '@/app/(storefront)/ogabassey/ogabassey-publication-safe-hero-fallback';
import { OGABASSEY_DESCRIPTION } from '@/config/ogabassey';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';

/**
 * Committed (non-fallback) home LCP copy. Must stay outside the route Suspense
 * that awaits `params` — awaiting in the page put HomeRouteLoading's 400px
 * skeleton ahead of the brand paragraph and pinned Slow-4G LCP at ~3.8s.
 *
 * Awaits `params` only. Do not read request APIs or `'use cache'` listing data.
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
        <OgabasseyPublicationSafeHeroFallback heroImageUrl="committed" />
      </div>
      <p className="ogabassey-home-unique-copy">{OGABASSEY_DESCRIPTION}</p>
    </>
  );
}
