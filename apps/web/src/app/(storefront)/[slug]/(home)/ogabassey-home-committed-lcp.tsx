import { OgabasseyHomeCriticalShell } from '@/app/(storefront)/ogabassey/ogabassey-home-critical-shell';
import { OgabasseyHomeHeroPreloadLink } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-preload-link';
import { OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL } from '@/config/ogabassey';
import { isOgabasseyHomeIdentifier } from './is-ogabassey-home-identifier';

/**
 * Early critical styles and accessible document heading, without a second
 * visible banner. The request-scoped publication owner renders the real hero.
 *
 * Also emits the committed slide-0 preload hint. This slot awaits `params`
 * only, so it streams in the first flush even when the layout's backend reads
 * run slow — the shell-driven twin deeper in the tree can only be discovered
 * after those reads resolve. Do not read request APIs or `'use cache'`
 * listing data here; the committed URL is inert hint bytes, never UI.
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
      <OgabasseyHomeHeroPreloadLink
        src={OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL}
      />
    </>
  );
}
