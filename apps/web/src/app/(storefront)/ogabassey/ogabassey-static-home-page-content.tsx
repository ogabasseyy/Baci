import { Suspense } from 'react';
import { OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL } from '@/config/ogabassey';
import { OgabasseyHomeCriticalShell } from './ogabassey-home-critical-shell';
import { OgabasseyHomeHeroPreloadLink } from './ogabassey-home-hero-preload-link';
import { OgabasseyHomeHeroReserveFallback } from './ogabassey-home-hero-reserve-fallback';
import { preloadOgabasseyHomeHeroResources } from './ogabassey-home-hero-resource-hints';
import { resolveOgabasseyHomeHeroShell } from './ogabassey-home-hero-shell-data';
import { OgabasseyHomePageContent } from './ogabassey-home-page-content';
import { OgabasseyHomeStaticShellHead } from './ogabassey-home-static-shell-head';

interface OgabasseyStaticHomePageContentProps {
  /** Static per-route prefix for request-streamed storefront links: '' for the
   *  apex domain and '/ogabassey' for the path route. */
  pathPrefix: string;
  /**
   * Set when the parent shell (`OgabasseyStaticHomePage`) already supplies:
   * 1. critical styles, heading, and the live slide-0 hero preload hint
   *    (`OgabasseyHomeCommittedLcp`),
   * 2. the static WebPage JSON-LD and style loader
   *    (`OgabasseyHomeStaticShellHead`), and
   * 3. an outer `<Suspense fallback={<OgabasseyHomeHeroReserveFallback />}>`
   *    boundary wrapping this component.
   * Suppresses downstream hero hints, the duplicate shell head, and the
   * nested inner hero-reserve Suspense boundary so each is emitted once.
   */
  omitCommittedHero?: boolean;
}

export async function OgabasseyStaticHomePageContent({
  omitCommittedHero = false,
  pathPrefix,
}: OgabasseyStaticHomePageContentProps) {
  // Cached-only lookup (never request APIs — those stay in the dynamic
  // subtree). Slides are inert data here: only the request-scoped subtree may
  // turn them into shopping UI after it confirms the current publication
  // state. The early shell supplies styles and an accessible heading only;
  // the publication-checked Hero owns the single visible banner.
  const heroShell = await resolveOgabasseyHomeHeroShell();
  const shellSlides =
    heroShell?.status === 'published' ? heroShell.slides : null;
  const shellMerchantId =
    heroShell?.status === 'published' ? heroShell.merchantId : null;
  const committedMobileLcpUrl = shellSlides?.[0]?.imageUrl ?? null;
  // Public immutable asset hints do not render shopping UI. Publication and
  // tenant checks remain in the request child (see the hero-shell contract).
  // Single preload owner: the static page sets omitCommittedHero because the
  // upstream committed slot already emits a scanner-visible <link> for the
  // live slide-0 URL, so any downstream hint for that URL would only
  // duplicate it. Emit downstream hints solely in the standalone
  // composition, where this component owns the hero; there the flight hint
  // additionally stays silent while live slide-0 still matches the
  // committed constant. Origin preconnect stays covered by
  // OgabasseyStaticResourceHints either way.
  if (
    committedMobileLcpUrl &&
    committedMobileLcpUrl !== OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL &&
    !omitCommittedHero
  ) {
    preloadOgabasseyHomeHeroResources(committedMobileLcpUrl);
  }
  const paintCommittedHero =
    Boolean(committedMobileLcpUrl) && !omitCommittedHero;

  return (
    <>
      {!omitCommittedHero && <OgabasseyHomeStaticShellHead />}
      {paintCommittedHero && committedMobileLcpUrl ? (
        <>
          <div data-ogabassey-home-lcp-shell="true">
            <OgabasseyHomeCriticalShell />
          </div>
          <OgabasseyHomeHeroPreloadLink src={committedMobileLcpUrl} />
          <Suspense fallback={<OgabasseyHomeHeroReserveFallback />}>
            <OgabasseyHomePageContent
              omitDocumentHeading
              pathPrefix={pathPrefix}
              shellMerchantId={shellMerchantId}
              shellSlides={shellSlides}
            />
          </Suspense>
        </>
      ) : (
        <>
          {/*
            No hero preload hint or second reserve boundary here: whenever
            omitCommittedHero is true, the upstream committed slot owns the
            scanner-visible hint and OgabasseyStaticHomePage already wraps
            this component in <Suspense fallback={<OgabasseyHomeHeroReserveFallback />}>.
            Avoiding a second nested reserve boundary saves ~19 KB of
            duplicate fallback HTML + RSC Flight payload and eliminates an
            extra Suspense boundary swap before Hero reveals.
          */}
          {omitCommittedHero ? (
            <OgabasseyHomePageContent
              omitDocumentHeading
              pathPrefix={pathPrefix}
              shellMerchantId={shellMerchantId}
              shellSlides={shellSlides}
            />
          ) : (
            <Suspense fallback={<OgabasseyHomeHeroReserveFallback />}>
              <OgabasseyHomePageContent
                omitDocumentHeading={false}
                pathPrefix={pathPrefix}
                shellMerchantId={shellMerchantId}
                shellSlides={shellSlides}
              />
            </Suspense>
          )}
        </>
      )}
    </>
  );
}
