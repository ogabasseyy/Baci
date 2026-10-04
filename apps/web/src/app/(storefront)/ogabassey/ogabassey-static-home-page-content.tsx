import { Suspense } from 'react';
import { JsonLd } from '@/components/seo/json-ld';
import {
  OGABASSEY_DESCRIPTION,
  OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL,
  OGABASSEY_HOME_URL,
  OGABASSEY_SOCIAL_IMAGE_URL,
  OGABASSEY_TITLE,
} from '@/config/ogabassey';
import { OgabasseyHomeCriticalShell } from './ogabassey-home-critical-shell';
import { OgabasseyHomeHeroPreloadLink } from './ogabassey-home-hero-preload-link';
import { OgabasseyHomeHeroReserveFallback } from './ogabassey-home-hero-reserve-fallback';
import { preloadOgabasseyHomeHeroResources } from './ogabassey-home-hero-resource-hints';
import { resolveOgabasseyHomeHeroShell } from './ogabassey-home-hero-shell-data';
import { OgabasseyHomePageContent } from './ogabassey-home-page-content';
import { OgabasseyHomeStyleLoader } from './ogabassey-home-style-loader';

interface OgabasseyStaticHomePageContentProps {
  /** Static per-route prefix for request-streamed storefront links: '' for the
   *  apex domain and '/ogabassey' for the path route. */
  pathPrefix: string;
  /** Set when the parent page already supplied critical styles and heading. */
  omitCommittedHero?: boolean;
}

const ogabasseyStaticHomepageSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: OGABASSEY_TITLE,
  description: OGABASSEY_DESCRIPTION,
  url: OGABASSEY_HOME_URL,
  isPartOf: {
    '@type': 'WebSite',
    name: 'OgaBassey',
    url: OGABASSEY_HOME_URL,
  },
  primaryImageOfPage: {
    '@type': 'ImageObject',
    url: OGABASSEY_SOCIAL_IMAGE_URL,
  },
} as const;

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
      <JsonLd data={ogabasseyStaticHomepageSchema} />
      <OgabasseyHomeStyleLoader />
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
            No hero preload hint here: whenever this branch renders with a
            live URL, omitCommittedHero is set and the upstream committed
            slot already owns the scanner-visible hint for that URL.
          */}
          <Suspense fallback={<OgabasseyHomeHeroReserveFallback />}>
            <OgabasseyHomePageContent
              omitDocumentHeading={omitCommittedHero}
              pathPrefix={pathPrefix}
              shellMerchantId={shellMerchantId}
              shellSlides={shellSlides}
            />
          </Suspense>
        </>
      )}
    </>
  );
}
